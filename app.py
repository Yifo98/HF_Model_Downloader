
# -*- coding: utf-8 -*-
import json
import os
import shutil
import sys
import threading
import time
import tkinter as tk
from tkinter import font
from tkinter import ttk, filedialog, messagebox

import requests
from huggingface_hub import HfApi, hf_hub_url


APP_NAME = "HF Downloader GUI"
CONFIG_DIR = os.path.join(os.getenv("APPDATA") or os.path.expanduser("~"), "hf_downloader_gui")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")


def ensure_config_dir():
    os.makedirs(CONFIG_DIR, exist_ok=True)


def load_config():
    if not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_config(data):
    ensure_config_dir()
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except OSError:
        pass


def recommended_threads():
    cpu = os.cpu_count() or 4
    return max(2, min(8, cpu))


def recommended_parallel(last_speed_bps):
    cpu = os.cpu_count() or 4
    base = max(2, min(8, cpu))
    if not last_speed_bps:
        return base
    speed_mb = last_speed_bps / 1024 / 1024
    if speed_mb < 5:
        return min(base, 2)
    if speed_mb < 20:
        return min(base, 4)
    return min(8, max(base, 4))


def recommended_chunk_size(last_speed_bps):
    if not last_speed_bps:
        return 512 * 1024
    speed_mb = last_speed_bps / 1024 / 1024
    if speed_mb < 5:
        return 256 * 1024
    if speed_mb < 20:
        return 512 * 1024
    if speed_mb < 80:
        return 1024 * 1024
    return 2 * 1024 * 1024


def repo_to_folder(repo_id):
    return repo_id.split("/")[-1].strip() if repo_id else ""


def classify_file(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in {".safetensors", ".bin", ".pt", ".pth"}:
        return "模型权重"
    if ext in {".json", ".yaml", ".yml"}:
        return "配置文件"
    if ext in {".txt", ".vocab", ".merges", ".model"}:
        return "分词/词表"
    if ext in {".md", ".rst", ".png", ".jpg", ".jpeg", ".gif"}:
        return "文档/图片"
    if ext:
        return "其他类型"
    return "无扩展名"


def classify_model_category(path):
    lower = path.lower()
    if "text-to-video" in lower or "text2video" in lower or "t2v" in lower or "video" in lower:
        return "文生视频"
    if "image-to-video" in lower or "img2video" in lower or "i2v" in lower:
        return "图生视频"
    if "image-to-image" in lower or "img2img" in lower or "i2i" in lower:
        return "图生图"
    if "text-to-image" in lower or "txt2img" in lower or "t2i" in lower:
        return "文生图"
    if "diffusion_model" in lower or "diffusion-model" in lower or "unet" in lower or "base_model" in lower:
        return "图生模型"
    if "lora" in lower or "lycoris" in lower:
        return "LoRA"
    if "vae" in lower:
        return "VAE"
    if "controlnet" in lower or "control-net" in lower:
        return "ControlNet"
    if "embedding" in lower or "textual_inversion" in lower or "textual-inversion" in lower:
        return "Embedding"
    if "clip" in lower or "tokenizer" in lower:
        return "文本编码"
    return "其他"


def format_size(num_bytes):
    if num_bytes is None:
        return "未知"
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} PB"


class StopDownload(Exception):
    pass


class WizardApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME)
        self.geometry("1020x760")
        self.minsize(920, 680)

        self.config_data = load_config()

        self.repo_id_var = tk.StringVar()
        self.token_var = tk.StringVar()
        self.save_token_var = tk.BooleanVar()
        self.show_token_var = tk.BooleanVar(value=False)

        self.dest_path_var = tk.StringVar()
        self.folder_name_var = tk.StringVar()
        self.auto_folder_name = True

        last_speed = self.config_data.get("last_speed_bps")
        self.use_threads_var = tk.BooleanVar(value=True)
        self.thread_count_var = tk.IntVar(value=recommended_parallel(last_speed))
        self.chunk_size_var = tk.IntVar(value=recommended_chunk_size(last_speed))

        self.show_incomplete_var = tk.BooleanVar(value=False)

        self.file_list = []
        self.file_meta = []
        self.selection_map = {}
        self.item_to_path = {}
        self.group_to_children = {}
        self.open_groups = set()

        self.category_filter_var = tk.StringVar(value="全部")
        self.ext_filter_var = tk.StringVar(value="全部")
        self.search_var = tk.StringVar(value="")

        self.download_state = {
            "running": False,
            "current_path": None,
            "current_size": None,
            "current_local": None,
            "completed_bytes": 0,
            "total_bytes": 0,
            "last_poll_time": None,
            "last_overall_value": 0,
            "last_history_time": None,
            "targets": [],
            "local_dir": None,
            "size_map": {},
            "chunk_size": self.chunk_size_var.get(),
        }
        self.stop_requested = False
        self.current_session_id = None
        self.pending_resume = None
        self.auto_start_resume = False
        self.history_window = None

        self.steps = []
        self.current_step = 0

        self._configure_styles()
        self._build_ui()
        self._load_defaults()
        self.repo_id_var.trace_add("write", self._on_repo_change)

    def _configure_styles(self):
        style = ttk.Style()
        try:
            style.theme_use("vista")
        except tk.TclError:
            pass
        style.configure("Accent.TButton", font=("Segoe UI", 10, "bold"))
        style.configure("Primary.TButton", font=("Segoe UI", 11, "bold"), padding=(12, 8))

    def _build_ui(self):
        self.container = ttk.Frame(self)
        self.container.pack(fill=tk.BOTH, expand=True, padx=16, pady=16)

        self.step_frame = ttk.Frame(self.container)
        self.step_frame.pack(fill=tk.BOTH, expand=True)

        self.nav_frame = ttk.Frame(self.container)
        self.nav_frame.pack(fill=tk.X, pady=(12, 0))

        self.back_btn = ttk.Button(self.nav_frame, text="上一步", command=self._prev_step)
        self.next_btn = ttk.Button(self.nav_frame, text="下一步", command=self._next_step)
        self.cancel_btn = ttk.Button(self.nav_frame, text="退出", command=self.destroy)

        self.back_btn.pack(side=tk.LEFT)
        self.cancel_btn.pack(side=tk.RIGHT)
        self.next_btn.pack(side=tk.RIGHT, padx=(0, 8))

        self.steps = [
            self._build_step_repo(),
            self._build_step_path(),
            self._build_step_files(),
            self._build_step_confirm(),
        ]
        self._show_step(0)

    def _build_step_repo(self):
        frame = ttk.Frame(self.step_frame)

        title = ttk.Label(frame, text="1. 输入仓库与Token", font=("Segoe UI", 12, "bold"))
        title.pack(anchor="w", pady=(0, 12))

        repo_row = ttk.Frame(frame)
        repo_row.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(repo_row, text="仓库名 (repo_id)").pack(side=tk.LEFT)
        repo_entry = ttk.Entry(repo_row, textvariable=self.repo_id_var, width=50)
        repo_entry.pack(side=tk.LEFT, padx=(12, 0), fill=tk.X, expand=True)

        token_row = ttk.Frame(frame)
        token_row.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(token_row, text="访问Token").pack(side=tk.LEFT)
        self.token_entry = ttk.Entry(token_row, textvariable=self.token_var, width=50, show="*")
        self.token_entry.pack(side=tk.LEFT, padx=(12, 0), fill=tk.X, expand=True)

        token_opts = ttk.Frame(frame)
        token_opts.pack(fill=tk.X, pady=(0, 8))
        ttk.Checkbutton(token_opts, text="显示Token", variable=self.show_token_var, command=self._toggle_token).pack(
            side=tk.LEFT
        )
        ttk.Checkbutton(token_opts, text="保存Token到本地", variable=self.save_token_var).pack(
            side=tk.LEFT, padx=(16, 0)
        )
        ttk.Button(token_opts, text="清除已保存Token", command=self._clear_saved_token).pack(side=tk.LEFT, padx=(16, 0))
        ttk.Button(token_opts, text="历史记录", command=self._open_history_window).pack(side=tk.LEFT, padx=(16, 0))

        note = ttk.Label(frame, text="Token 仅用于访问 Hugging Face，保存时会写入本机配置文件。", foreground="#555")
        note.pack(anchor="w", pady=(6, 0))

        return frame

    def _build_step_path(self):
        frame = ttk.Frame(self.step_frame)
        title = ttk.Label(frame, text="2. 选择下载路径与线程", font=("Segoe UI", 12, "bold"))
        title.pack(anchor="w", pady=(0, 12))

        path_row = ttk.Frame(frame)
        path_row.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(path_row, text="保存路径").pack(side=tk.LEFT)
        path_entry = ttk.Entry(path_row, textvariable=self.dest_path_var, width=50)
        path_entry.pack(side=tk.LEFT, padx=(12, 0), fill=tk.X, expand=True)
        ttk.Button(path_row, text="选择...", command=self._browse_path).pack(side=tk.LEFT, padx=(8, 0))

        folder_row = ttk.Frame(frame)
        folder_row.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(folder_row, text="保存文件夹名").pack(side=tk.LEFT)
        folder_entry = ttk.Entry(folder_row, textvariable=self.folder_name_var, width=50)
        folder_entry.pack(side=tk.LEFT, padx=(12, 0), fill=tk.X, expand=True)
        folder_entry.bind("<Key>", self._on_folder_edit)

        thread_row = ttk.Frame(frame)
        thread_row.pack(fill=tk.X, pady=(8, 4))
        ttk.Checkbutton(thread_row, text="启用并行下载", variable=self.use_threads_var, command=self._toggle_threads).pack(
            side=tk.LEFT
        )
        self.thread_spin = ttk.Spinbox(
            thread_row, from_=1, to=64, textvariable=self.thread_count_var, width=6, state="disabled"
        )
        self.thread_spin.pack(side=tk.LEFT, padx=(12, 0))

        rec = recommended_parallel(self.config_data.get("last_speed_bps"))
        self.thread_hint = ttk.Label(
            frame,
            text=(f"推荐并行数: {rec} (基于CPU核数与最近下载速度估算)"),
        )
        self.thread_hint.pack(anchor="w", pady=(4, 0))

        chunk_row = ttk.Frame(frame)
        chunk_row.pack(fill=tk.X, pady=(6, 4))
        ttk.Label(chunk_row, text="智能分块").pack(side=tk.LEFT)
        self.chunk_label = ttk.Label(
            chunk_row,
            text=f"推荐分块: {format_size(self.chunk_size_var.get())}",
            foreground="#555",
        )
        self.chunk_label.pack(side=tk.LEFT, padx=(12, 0))

        return frame
    def _build_step_files(self):
        frame = ttk.Frame(self.step_frame)
        title = ttk.Label(frame, text="3. 选择要下载的文件", font=("Segoe UI", 12, "bold"))
        title.pack(anchor="w", pady=(0, 8))

        action_panel = ttk.LabelFrame(frame, text="关键操作")
        action_panel.pack(fill=tk.X, pady=(0, 8))

        self.load_files_btn = ttk.Button(
            action_panel,
            text="加载文件列表（必点）",
            command=self._load_files,
            style="Primary.TButton",
        )
        self.load_files_btn.pack(side=tk.LEFT, padx=12, pady=8)
        tip = ttk.Label(action_panel, text="先加载列表，再勾选要下载的文件。", foreground="#444")
        tip.pack(side=tk.LEFT, padx=(8, 0))

        toolbar = ttk.Frame(frame)
        toolbar.pack(fill=tk.X)
        ttk.Label(toolbar, text="勾选=下载", foreground="#555").pack(side=tk.LEFT)

        filter_row = ttk.Frame(frame)
        filter_row.pack(fill=tk.X, pady=(8, 4))
        ttk.Label(filter_row, text="文件类型").pack(side=tk.LEFT)
        self.category_filter = ttk.Combobox(filter_row, textvariable=self.category_filter_var, state="readonly", width=18)
        self.category_filter.pack(side=tk.LEFT, padx=(8, 16))
        self.category_filter.bind("<<ComboboxSelected>>", lambda _e: self._apply_filters())

        ttk.Label(filter_row, text="扩展名").pack(side=tk.LEFT)
        self.ext_filter = ttk.Combobox(filter_row, textvariable=self.ext_filter_var, state="readonly", width=18)
        self.ext_filter.pack(side=tk.LEFT, padx=(8, 0))
        self.ext_filter.bind("<<ComboboxSelected>>", lambda _e: self._apply_filters())

        self.incomplete_cb = ttk.Checkbutton(
            filter_row, text="仅显示未完成", variable=self.show_incomplete_var, command=self._apply_filters
        )
        self.incomplete_cb.pack(side=tk.LEFT, padx=(16, 0))

        search_row = ttk.Frame(frame)
        search_row.pack(fill=tk.X, pady=(4, 0))
        ttk.Label(search_row, text="搜索").pack(side=tk.LEFT)
        self.search_entry = ttk.Entry(search_row, textvariable=self.search_var, width=40)
        self.search_entry.pack(side=tk.LEFT, padx=(8, 0), fill=tk.X, expand=True)
        self.search_entry.bind("<KeyRelease>", lambda _e: self._apply_filters())

        list_frame = ttk.Frame(frame)
        list_frame.pack(fill=tk.BOTH, expand=True, pady=(8, 0))

        self.tree = ttk.Treeview(
            list_frame,
            columns=("model", "size", "remaining", "type"),
            show="tree headings",
            selectmode="none",
        )
        self.tree.heading("#0", text="选择")
        self.tree.heading("model", text="模型类型")
        self.tree.heading("size", text="大小")
        self.tree.heading("remaining", text="剩余")
        self.tree.heading("type", text="文件类型")
        self.tree.column("#0", width=300, anchor="w")
        self.tree.column("model", width=140, anchor="w")
        self.tree.column("size", width=110, anchor="e")
        self.tree.column("remaining", width=110, anchor="e")
        self.tree.column("type", width=140, anchor="w")
        self.tree.bind("<Button-1>", self._on_tree_click)

        scroll_y = ttk.Scrollbar(list_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll_y.set)

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scroll_y.pack(side=tk.LEFT, fill=tk.Y)

        action_row = ttk.Frame(frame)
        action_row.pack(fill=tk.X, pady=(6, 0))
        self.select_all_btn = ttk.Button(action_row, text="全选/全不选", command=self._toggle_select_all)
        self.select_all_btn.pack(side=tk.LEFT)
        ttk.Button(action_row, text="全部展开", command=self._expand_all).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(action_row, text="全部收起", command=self._collapse_all).pack(side=tk.LEFT, padx=(8, 0))

        self.file_status = ttk.Label(frame, text="尚未加载文件列表", foreground="#555")
        self.file_status.pack(anchor="w", pady=(6, 0))

        return frame

    def _build_step_confirm(self):
        frame = ttk.Frame(self.step_frame)
        title = ttk.Label(frame, text="4. 确认并下载", font=("Segoe UI", 12, "bold"))
        title.pack(anchor="w", pady=(0, 8))

        start_panel = ttk.LabelFrame(frame, text="开始下载")
        start_panel.pack(fill=tk.X, pady=(0, 8))

        self.start_btn = ttk.Button(
            start_panel,
            text="开始下载",
            command=self._start_download,
            style="Primary.TButton",
        )
        self.start_btn.pack(side=tk.LEFT, padx=12, pady=8)
        self.stop_btn = ttk.Button(start_panel, text="暂停", command=self._stop_download, state="disabled")
        self.stop_btn.pack(side=tk.LEFT, padx=(8, 0), pady=8)
        self.resume_btn = ttk.Button(start_panel, text="恢复", command=self._resume_download, state="disabled")
        self.resume_btn.pack(side=tk.LEFT, padx=(8, 0), pady=8)
        start_tip = ttk.Label(start_panel, text="点击后将在下方显示进度与速度。", foreground="#444")
        start_tip.pack(side=tk.LEFT, padx=(12, 0))

        nav_panel = ttk.Frame(frame)
        nav_panel.pack(fill=tk.X, pady=(0, 8))
        ttk.Button(nav_panel, text="上一步", command=self._prev_step).pack(side=tk.LEFT)
        ttk.Button(nav_panel, text="返回首页", command=lambda: self._show_step(0)).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(nav_panel, text="退出", command=self.destroy).pack(side=tk.RIGHT)

        self.summary_text = tk.Text(frame, height=8, wrap="word")
        self.summary_text.pack(fill=tk.X, padx=(0, 0), pady=(0, 8))
        self.summary_text.configure(state="disabled")

        progress_frame = ttk.LabelFrame(frame, text="下载进度")
        progress_frame.pack(fill=tk.X, pady=(0, 8))

        self.overall_label = ttk.Label(progress_frame, text="总进度: 0 / 0")
        self.overall_label.pack(anchor="w", padx=8, pady=(6, 2))
        self.overall_progress = ttk.Progressbar(progress_frame, mode="determinate")
        self.overall_progress.pack(fill=tk.X, padx=8, pady=(0, 6))

        self.file_label = ttk.Label(progress_frame, text="当前文件: -")
        self.file_label.pack(anchor="w", padx=8, pady=(0, 2))
        self.file_progress = ttk.Progressbar(progress_frame, mode="determinate")
        self.file_progress.pack(fill=tk.X, padx=8, pady=(0, 6))

        self.remaining_label = ttk.Label(progress_frame, text="剩余: 0 B")
        self.remaining_label.pack(anchor="w", padx=8, pady=(0, 6))
        self.speed_label = ttk.Label(progress_frame, text="速度: 0 B/s")
        self.speed_label.pack(anchor="w", padx=8, pady=(0, 6))

        incomplete_frame = ttk.LabelFrame(frame, text="未完成下载")
        incomplete_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 8))

        self.incomplete_tree = ttk.Treeview(
            incomplete_frame,
            columns=("remaining",),
            show="tree headings",
            height=6,
        )
        self.incomplete_tree.heading("#0", text="文件")
        self.incomplete_tree.heading("remaining", text="剩余")
        self.incomplete_tree.column("#0", width=520, anchor="w")
        self.incomplete_tree.column("remaining", width=140, anchor="e")
        self.incomplete_tree.pack(fill=tk.BOTH, expand=True, padx=8, pady=6)

        self.log = tk.Text(frame, height=10, wrap="word")
        self.log.pack(fill=tk.BOTH, expand=True, pady=(8, 0))
        self.log.configure(state="disabled")

        return frame

    def _show_step(self, index):
        for child in self.step_frame.winfo_children():
            child.pack_forget()
        self.steps[index].pack(fill=tk.BOTH, expand=True)

        self.current_step = index
        self.back_btn.configure(state="normal" if index > 0 else "disabled")
        self.next_btn.configure(text="下一步" if index < len(self.steps) - 1 else "返回首页")

        if index == len(self.steps) - 1:
            self._refresh_summary()
            self._refresh_incomplete_list()

    def _next_step(self):
        if not self._validate_step(self.current_step):
            return
        if self.current_step == len(self.steps) - 1:
            self._show_step(0)
            return
        self._show_step(self.current_step + 1)

    def _prev_step(self):
        if self.current_step > 0:
            self._show_step(self.current_step - 1)

    def _validate_step(self, step):
        if step == 0:
            if not self.repo_id_var.get().strip():
                messagebox.showwarning("提示", "请填写仓库名")
                return False
            if not self.token_var.get().strip():
                messagebox.showwarning("提示", "请填写Token")
                return False
            return True
        if step == 1:
            if not self.dest_path_var.get().strip():
                messagebox.showwarning("提示", "请选择或输入保存路径")
                return False
            if not self.folder_name_var.get().strip():
                messagebox.showwarning("提示", "请填写保存文件夹名")
                return False
            return True
        if step == 2:
            selection = self._get_selected_files()
            if not selection:
                messagebox.showwarning("提示", "请选择要下载的文件")
                return False
            return True
        return True

    def _toggle_token(self):
        self.token_entry.configure(show="" if self.show_token_var.get() else "*")

    def _clear_saved_token(self):
        self.config_data.pop("token", None)
        save_config(self.config_data)
        messagebox.showinfo("提示", "已清除保存的Token")

    def _load_defaults(self):
        token = self.config_data.get("token")
        if token:
            self.token_var.set(token)
            self.save_token_var.set(True)
        default_path = self.config_data.get("default_path")
        if default_path:
            self.dest_path_var.set(default_path)
        if "delete_files_default" not in self.config_data:
            self.config_data["delete_files_default"] = False
            self._save_history()
        if "delete_files_default_set" not in self.config_data:
            self.config_data["delete_files_default_set"] = False
            self._save_history()

    def _get_history(self):
        history = self.config_data.get("history")
        if not isinstance(history, list):
            history = []
            self.config_data["history"] = history
        return history

    def _save_history(self):
        save_config(self.config_data)

    def _record_history_start(self, repo_id, dest, folder, files, size_map):
        total_bytes = sum(size_map.get(p) or 0 for p in files)
        history = self._get_history()
        if history:
            latest = history[0]
            if (
                latest.get("status") == "unfinished"
                and latest.get("repo_id") == repo_id
                and latest.get("dest") == dest
                and latest.get("folder") == folder
                and set(latest.get("files") or []) == set(files)
            ):
                latest.update(
                    {
                        "files": files,
                        "file_sizes": {p: size_map.get(p) for p in files},
                        "total_bytes": total_bytes,
                        "updated_at": time.time(),
                    }
                )
                self.current_session_id = latest.get("id")
                self._save_history()
                return

        session_id = f"{int(time.time())}-{len(history)}"
        entry = {
            "id": session_id,
            "repo_id": repo_id,
            "dest": dest,
            "folder": folder,
            "files": files,
            "file_sizes": {p: size_map.get(p) for p in files},
            "total_bytes": total_bytes,
            "completed_bytes": 0,
            "status": "unfinished",
            "updated_at": time.time(),
        }
        history.insert(0, entry)
        self.current_session_id = session_id
        self._save_history()

    def _record_history_progress(self, completed_bytes):
        if not self.current_session_id:
            return
        for entry in self._get_history():
            if entry.get("id") == self.current_session_id:
                entry["completed_bytes"] = completed_bytes
                entry["updated_at"] = time.time()
                break
        self._save_history()

    def _record_history_finish(self, completed=True):
        if not self.current_session_id:
            return
        for entry in self._get_history():
            if entry.get("id") == self.current_session_id:
                entry["status"] = "completed" if completed else "unfinished"
                if completed:
                    entry["completed_bytes"] = entry.get("total_bytes") or entry.get("completed_bytes", 0)
                else:
                    entry["completed_bytes"] = self._compute_completed_bytes(entry)
                entry["updated_at"] = time.time()
                break
        self._save_history()

    def _compute_completed_bytes(self, entry):
        dest = entry.get("dest") or ""
        folder = entry.get("folder") or ""
        local_dir = os.path.join(dest, folder) if dest and folder else None
        completed_bytes = 0
        file_sizes = entry.get("file_sizes") or {}
        for path, expected in file_sizes.items():
            if not local_dir:
                continue
            local_path = os.path.join(local_dir, path)
            if os.path.exists(local_path):
                size = os.path.getsize(local_path)
                if expected:
                    completed_bytes += min(size, expected)
                else:
                    completed_bytes += size
        return completed_bytes

    def _open_history_window(self):
        if self.history_window and self.history_window.winfo_exists():
            self.history_window.lift()
            return

        window = tk.Toplevel(self)
        window.title("历史记录")
        window.geometry("760x420")
        self.history_window = window

        style = ttk.Style(window)
        tab_font = font.nametofont("TkDefaultFont").copy()
        default_size = tab_font.cget("size")
        tab_font.configure(weight="bold", size=max(default_size - 1, 9))
        style.configure("History.TNotebook.Tab", padding=(10, 4), font=tab_font)
        style.map(
            "History.TNotebook.Tab",
            foreground=[("selected", "#111111"), ("!selected", "#7A7A7A")],
            background=[("selected", "#EEF4FF"), ("!selected", "#F8F8F8")],
        )
        notebook = ttk.Notebook(window, style="History.TNotebook")
        notebook.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        unfinished_frame = ttk.Frame(notebook)
        completed_frame = ttk.Frame(notebook)
        notebook.add(unfinished_frame, text="未完成（进行中）")
        notebook.add(completed_frame, text="已完成（已结束）")

        columns = ("repo", "progress", "updated")
        self.unfinished_tree = ttk.Treeview(unfinished_frame, columns=columns, show="headings", selectmode="browse")
        for col, text, width in (
            ("repo", "仓库", 240),
            ("progress", "进度", 160),
            ("updated", "更新时间", 200),
        ):
            self.unfinished_tree.heading(col, text=text)
            self.unfinished_tree.column(col, width=width, anchor="w")
        self.unfinished_tree.pack(fill=tk.BOTH, expand=True, padx=6, pady=6)

        action_row = ttk.Frame(unfinished_frame)
        action_row.pack(fill=tk.X, padx=6, pady=(0, 6))
        ttk.Button(action_row, text="继续下载", command=self._resume_selected_history).pack(side=tk.LEFT)
        ttk.Button(action_row, text="删除记录", command=self._delete_selected_history).pack(side=tk.LEFT, padx=(8, 0))

        self.completed_tree = ttk.Treeview(completed_frame, columns=columns, show="headings", selectmode="browse")
        for col, text, width in (
            ("repo", "仓库", 240),
            ("progress", "进度", 160),
            ("updated", "更新时间", 200),
        ):
            self.completed_tree.heading(col, text=text)
            self.completed_tree.column(col, width=width, anchor="w")
        self.completed_tree.pack(fill=tk.BOTH, expand=True, padx=6, pady=6)

        completed_action = ttk.Frame(completed_frame)
        completed_action.pack(fill=tk.X, padx=6, pady=(0, 6))
        ttk.Button(completed_action, text="删除记录", command=self._delete_selected_history).pack(side=tk.LEFT)

        self._populate_history_tables()

    def _populate_history_tables(self):
        for tree in (self.unfinished_tree, self.completed_tree):
            tree.delete(*tree.get_children())

        history = self._get_history()
        for entry in history:
            progress_text, _remaining = self._calculate_entry_progress(entry)
            updated = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(entry.get("updated_at", time.time())))
            target_tree = self.completed_tree if entry.get("status") == "completed" else self.unfinished_tree
            target_tree.insert("", tk.END, iid=entry.get("id"), values=(entry.get("repo_id"), progress_text, updated))

    def _calculate_entry_progress(self, entry):
        total_bytes = entry.get("total_bytes") or 0
        completed_bytes = 0
        dest = entry.get("dest") or ""
        folder = entry.get("folder") or ""
        local_dir = os.path.join(dest, folder) if dest and folder else None
        file_sizes = entry.get("file_sizes") or {}
        for path, expected in file_sizes.items():
            if not local_dir:
                continue
            local_path = os.path.join(local_dir, path)
            if os.path.exists(local_path):
                size = os.path.getsize(local_path)
                if expected:
                    completed_bytes += min(size, expected)
                else:
                    completed_bytes += size
        if total_bytes > 0:
            percent = min(completed_bytes / total_bytes * 100, 100.0)
            remaining = max(total_bytes - completed_bytes, 0)
            return f"{percent:.1f}% / {format_size(remaining)}", remaining
        return "未知", None

    def _resume_selected_history(self):
        selection = self.unfinished_tree.selection()
        if not selection:
            messagebox.showwarning("提示", "请选择要继续的记录")
            return
        entry_id = selection[0]
        entry = next((item for item in self._get_history() if item.get("id") == entry_id), None)
        if not entry:
            return
        self.pending_resume = entry
        self.auto_start_resume = True
        self.repo_id_var.set(entry.get("repo_id", ""))
        self.dest_path_var.set(entry.get("dest", ""))
        self.folder_name_var.set(entry.get("folder", ""))
        self._show_step(2)
        self._load_files()
        if self.history_window and self.history_window.winfo_exists():
            self.history_window.destroy()
            self.history_window = None

    def _delete_selected_history(self):
        for tree in (self.unfinished_tree, self.completed_tree):
            selection = tree.selection()
            if selection:
                entry_id = selection[0]
                entry = next((item for item in self._get_history() if item.get("id") == entry_id), None)
                if not entry:
                    return
                if self.config_data.get("delete_files_default_set"):
                    delete_files = bool(self.config_data.get("delete_files_default"))
                    remember = False
                else:
                    result = self._confirm_delete_history()
                    if result is None:
                        return
                    delete_files, remember = result
                if delete_files is None:
                    return
                if remember:
                    self.config_data["delete_files_default"] = delete_files
                    self.config_data["delete_files_default_set"] = True
                    self._save_history()
                if delete_files:
                    self._delete_entry_files(entry)
                history = [item for item in self._get_history() if item.get("id") != entry_id]
                self.config_data["history"] = history
                self._save_history()
                self._populate_history_tables()
                return

    def _confirm_delete_history(self):
        dialog = tk.Toplevel(self)
        dialog.title("确认删除")
        dialog.resizable(False, False)
        dialog.grab_set()

        ttk.Label(dialog, text="是否删除本地文件夹及全部内容？").pack(padx=16, pady=(12, 8), anchor="w")

        delete_var = tk.BooleanVar(value=bool(self.config_data.get("delete_files_default", False)))
        remember_var = tk.BooleanVar(value=False)

        ttk.Checkbutton(dialog, text="同时删除本地文件", variable=delete_var).pack(padx=16, anchor="w")
        ttk.Checkbutton(dialog, text="记住此选择为默认(以后不再提示)", variable=remember_var).pack(
            padx=16, pady=(4, 8), anchor="w"
        )

        result = {"value": None}

        def on_ok():
            result["value"] = (delete_var.get(), remember_var.get())
            dialog.destroy()

        def on_cancel():
            result["value"] = None
            dialog.destroy()

        button_row = ttk.Frame(dialog)
        button_row.pack(fill=tk.X, padx=16, pady=(0, 12))
        ttk.Button(button_row, text="取消", command=on_cancel).pack(side=tk.RIGHT)
        ttk.Button(button_row, text="确认", command=on_ok).pack(side=tk.RIGHT, padx=(0, 8))

        dialog.wait_window()
        return result["value"]

    def _delete_entry_files(self, entry):
        dest = entry.get("dest") or ""
        folder = entry.get("folder") or ""
        if not dest or not folder:
            return
        target = os.path.join(dest, folder)
        if os.path.exists(target):
            shutil.rmtree(target, ignore_errors=True)

    def _resume_after_load(self):
        self.auto_start_resume = False
        entry = self.pending_resume
        self.pending_resume = None
        if not entry:
            return
        if not self.token_var.get().strip():
            messagebox.showwarning("提示", "请先填写Token再继续下载")
            return
        self._show_step(3)
        self._start_download()

    def _browse_path(self):
        path = filedialog.askdirectory()
        if path:
            self.dest_path_var.set(path)
            self.config_data["default_path"] = path
            save_config(self.config_data)
            if self.auto_folder_name:
                self.folder_name_var.set(repo_to_folder(self.repo_id_var.get().strip()))

    def _on_repo_change(self, *_args):
        if self.auto_folder_name:
            self.folder_name_var.set(repo_to_folder(self.repo_id_var.get().strip()))

    def _on_folder_edit(self, _event):
        self.auto_folder_name = False

    def _toggle_threads(self):
        state = "normal" if self.use_threads_var.get() else "disabled"
        self.thread_spin.configure(state=state)

    def _load_files(self):
        repo_id = self.repo_id_var.get().strip()
        token = self.token_var.get().strip()
        if not repo_id or not token:
            messagebox.showwarning("提示", "请先填写仓库名和Token")
            return

        self.file_status.configure(text="正在加载文件列表...")
        self.tree.delete(*self.tree.get_children())

        def worker():
            try:
                api = HfApi()
                tree = api.list_repo_tree(repo_id=repo_id, token=token, recursive=True)
                files = []
                for item in tree:
                    item_type = getattr(item, "type", None)
                    if item_type and item_type != "file":
                        continue
                    path = getattr(item, "path", None)
                    if not path:
                        continue
                    if path.endswith("/"):
                        continue
                    size = getattr(item, "size", None)
                    if size is None:
                        _, ext = os.path.splitext(path)
                        base = os.path.basename(path)
                        if not ext and not base.startswith("."):
                            continue
                    files.append((path, size))
                self.file_list = sorted([f[0] for f in files])
                size_map = {path: size for path, size in files}
                self.file_meta = [
                    (
                        f,
                        classify_file(f),
                        os.path.splitext(f)[1].lower() or "(无)",
                        size_map.get(f),
                        classify_model_category(f),
                    )
                    for f in self.file_list
                ]
                self.selection_map = {path: False for path in self.file_list}
                pending = self.pending_resume
                if pending and pending.get("repo_id") == repo_id:
                    resume_files = set(pending.get("files") or [])
                    for path in self.selection_map:
                        if path in resume_files:
                            self.selection_map[path] = True
                    if self.auto_start_resume:
                        self.after(0, self._resume_after_load)
                self.after(0, self._update_filters)
                self.after(0, self._apply_filters)
                self.after(0, lambda: self.file_status.configure(text=f"共 {len(self.file_list)} 个文件"))
            except Exception as exc:
                self.after(0, lambda: self.file_status.configure(text="加载失败"))
                self.after(0, lambda: messagebox.showerror("错误", f"加载文件列表失败: {exc}"))

        threading.Thread(target=worker, daemon=True).start()

    def _update_filters(self):
        categories = sorted({meta[1] for meta in self.file_meta})
        exts = sorted({meta[2] for meta in self.file_meta})
        self.category_filter["values"] = ["全部"] + categories
        self.ext_filter["values"] = ["全部"] + exts
        if self.category_filter_var.get() not in self.category_filter["values"]:
            self.category_filter_var.set("全部")
        if self.ext_filter_var.get() not in self.ext_filter["values"]:
            self.ext_filter_var.set("全部")

    def _get_local_dir(self):
        dest = self.dest_path_var.get().strip()
        folder = self.folder_name_var.get().strip()
        if not dest or not folder:
            return None
        return os.path.join(dest, folder)

    def _get_local_size(self, rel_path):
        local_dir = self._get_local_dir()
        if not local_dir:
            return None
        local_path = os.path.join(local_dir, rel_path)
        if os.path.exists(local_path):
            return os.path.getsize(local_path)
        return 0

    def _apply_filters(self):
        open_groups = set()
        for item in self.tree.get_children():
            if self.tree.item(item, "open"):
                label = self.tree.item(item, "text").split(" (", 1)[0]
                open_groups.add(label)
        if open_groups:
            self.open_groups = open_groups

        self.tree.delete(*self.tree.get_children())
        self.item_to_path = {}
        self.group_to_children = {}

        cat_filter = self.category_filter_var.get()
        ext_filter = self.ext_filter_var.get()
        keyword = self.search_var.get().strip().lower()
        only_incomplete = self.show_incomplete_var.get()

        filtered = []
        for path, category, ext, size, model_category in self.file_meta:
            if cat_filter != "全部" and category != cat_filter:
                continue
            if ext_filter != "全部" and ext != ext_filter:
                continue
            if keyword and keyword not in path.lower():
                continue
            local_size = self._get_local_size(path)
            remaining = None
            if size is not None and local_size is not None:
                remaining = max(size - local_size, 0)
            if only_incomplete and remaining is not None and remaining == 0:
                continue
            filtered.append((path, category, ext, size, model_category, remaining))

        groups = {}
        for item in filtered:
            groups.setdefault(item[4], []).append(item)

        for model_category in sorted(groups.keys()):
            items = sorted(groups[model_category], key=lambda x: x[0])
            parent = self.tree.insert("", tk.END, text=f"{model_category} ({len(items)})", tags=("group",))
            if model_category in self.open_groups:
                self.tree.item(parent, open=True)
            self.group_to_children[parent] = []
            for path, category, _ext, size, _model, remaining in items:
                checked = "☑" if self.selection_map.get(path) else "☐"
                child = self.tree.insert(
                    parent,
                    tk.END,
                    text=f"{checked} {path}",
                    values=(
                        model_category,
                        format_size(size),
                        format_size(remaining) if remaining is not None else "未知",
                        category,
                    ),
                    tags=("file",),
                )
                self.item_to_path[child] = path
                self.group_to_children[parent].append(child)

        if self.file_meta:
            self._update_selection_status()
            self.file_status.configure(text=f"筛选结果: {len(filtered)} / {len(self.file_meta)} 个文件")

    def _update_selection_status(self):
        selected = len(self._get_selected_files())
        total = len(self.file_meta)
        if self.selection_map:
            self.select_all_btn.configure(text="全选/全不选")
        self.file_status.configure(text=f"已选 {selected} / {total} 个文件")

    def _on_tree_click(self, event):
        region = self.tree.identify("region", event.x, event.y)
        if region not in {"cell", "tree"}:
            return
        column = self.tree.identify_column(event.x)
        item = self.tree.identify_row(event.y)
        if not item:
            return
        tags = self.tree.item(item, "tags")
        is_group = "group" in tags
        is_file = "file" in tags

        if is_group and region == "tree" and column == "#0":
            return

        if is_group:
            children = self.group_to_children.get(item, [])
            any_unchecked = any(not self.selection_map.get(self.item_to_path.get(child, "")) for child in children)
            for child in children:
                path = self.item_to_path.get(child)
                if path:
                    self.selection_map[path] = any_unchecked
            self._apply_filters()
            return "break"

        if is_file:
            path = self.item_to_path.get(item)
            if not path:
                return
            self.selection_map[path] = not self.selection_map.get(path)
            self._apply_filters()
            return "break"
        return

    def _expand_all(self):
        self.open_groups = set()
        for item in self.tree.get_children():
            label = self.tree.item(item, "text").split(" (", 1)[0]
            self.open_groups.add(label)
            self.tree.item(item, open=True)

    def _collapse_all(self):
        self.open_groups = set()
        for item in self.tree.get_children():
            self.tree.item(item, open=False)

    def _select_all_files(self):
        for path in self.selection_map:
            self.selection_map[path] = True
        self._apply_filters()

    def _clear_selection(self):
        for path in self.selection_map:
            self.selection_map[path] = False
        self._apply_filters()

    def _toggle_select_all(self):
        if not self.selection_map:
            return
        any_unchecked = any(not checked for checked in self.selection_map.values())
        for path in self.selection_map:
            self.selection_map[path] = any_unchecked
        self.select_all_btn.configure(text="全选/全不选")
        self._apply_filters()

    def _get_selected_files(self):
        return [path for path in self.file_list if self.selection_map.get(path)]
    def _refresh_summary(self):
        repo_id = self.repo_id_var.get().strip()
        dest = self.dest_path_var.get().strip()
        folder = self.folder_name_var.get().strip()
        token_saved = "是" if self.save_token_var.get() else "否"
        thread_info = "默认" if not self.use_threads_var.get() else str(self.thread_count_var.get())
        files = f"已选 {len(self._get_selected_files())} 个文件"

        summary = (
            f"仓库名: {repo_id}\n"
            f"保存路径: {dest}\n"
            f"保存文件夹: {folder}\n"
            f"保存Token: {token_saved}\n"
            f"线程数: {thread_info}\n"
            f"下载范围: {files}\n"
        )

        self.summary_text.configure(state="normal")
        self.summary_text.delete("1.0", tk.END)
        self.summary_text.insert(tk.END, summary)
        self.summary_text.configure(state="disabled")

    def _refresh_incomplete_list(self):
        self.incomplete_tree.delete(*self.incomplete_tree.get_children())
        selected = self._get_selected_files()
        remaining_total = 0
        for path, _category, _ext, size, _model in self.file_meta:
            if path not in selected:
                continue
            local_size = self._get_local_size(path)
            if size is None or local_size is None:
                continue
            remaining = max(size - local_size, 0)
            if remaining > 0:
                self.incomplete_tree.insert("", tk.END, text=path, values=(format_size(remaining),))
                remaining_total += remaining
        self.remaining_label.configure(text=f"剩余: {format_size(remaining_total)}")

    def _start_download(self):
        if not self._validate_step(2):
            return
        repo_id = self.repo_id_var.get().strip()
        token = self.token_var.get().strip()
        dest = self.dest_path_var.get().strip()
        folder = self.folder_name_var.get().strip()
        save_token_flag = self.save_token_var.get()

        if save_token_flag:
            self.config_data["token"] = token
            save_config(self.config_data)
        else:
            self.config_data.pop("token", None)
            save_config(self.config_data)

        if dest:
            self.config_data["default_path"] = dest
            save_config(self.config_data)

        local_dir = os.path.join(dest, folder)
        os.makedirs(local_dir, exist_ok=True)

        targets = self._get_selected_files()

        size_map = {path: size for path, _c, _e, size, _m in self.file_meta}
        total_bytes = sum(size_map.get(p) or 0 for p in targets)

        self.download_state.update(
            {
                "running": True,
                "current_path": None,
                "current_size": None,
                "current_local": None,
                "completed_bytes": 0,
                "total_bytes": total_bytes,
                "last_poll_time": None,
                "last_overall_value": 0,
                "last_history_time": None,
                "targets": targets,
                "local_dir": local_dir,
                "size_map": size_map,
                "chunk_size": self.chunk_size_var.get(),
            }
        )

        self.overall_progress.configure(maximum=total_bytes if total_bytes > 0 else 1)
        self.file_progress.configure(maximum=1)
        self.overall_progress["value"] = 0
        self.file_progress["value"] = 0
        self.overall_progress.configure(mode="determinate" if total_bytes > 0 else "indeterminate")
        if total_bytes == 0:
            self.overall_progress.start(10)
        else:
            self.overall_progress.stop()

        self.stop_requested = False
        self._log("开始下载...\n")
        self.start_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")

        def worker():
            completed_bytes = 0
            try:
                self._record_history_start(repo_id, dest, folder, targets, size_map)
                if self.use_threads_var.get() and len(targets) > 1:
                    max_workers = max(1, int(self.thread_count_var.get()))
                    self.after(0, lambda: self.file_label.configure(text="当前文件: 并行下载中"))
                    self.after(0, self._poll_progress)

                    def download_one(path):
                        while self.stop_requested:
                            time.sleep(0.2)
                        size = size_map.get(path)
                        local_path = os.path.join(local_dir, path)
                        os.makedirs(os.path.dirname(local_path), exist_ok=True)
                        self.download_state["current_path"] = path
                        self.download_state["current_size"] = size
                        self.download_state["current_local"] = local_path
                        self._download_file_http(repo_id, path, token, local_path, size)

                    from concurrent.futures import ThreadPoolExecutor, as_completed

                    with ThreadPoolExecutor(max_workers=max_workers) as executor:
                        futures = [executor.submit(download_one, path) for path in targets]
                        for future in as_completed(futures):
                            while self.stop_requested:
                                time.sleep(0.2)
                            future.result()
                else:
                    for path in targets:
                        while self.stop_requested:
                            time.sleep(0.2)
                        size = size_map.get(path)
                        local_path = os.path.join(local_dir, path)
                        os.makedirs(os.path.dirname(local_path), exist_ok=True)
                        self.download_state["current_path"] = path
                        self.download_state["current_size"] = size
                        self.download_state["current_local"] = local_path
                        self.after(0, lambda p=path: self.file_label.configure(text=f"当前文件: {p}"))
                        self.after(0, self._poll_progress)

                        self._download_file_http(repo_id, path, token, local_path, size)

                self.after(0, lambda: self._log(f"下载完成: {local_dir}\n"))
                self.after(0, lambda: messagebox.showinfo("完成", f"完成\\n下载已保存到: {local_dir}"))
                self._record_history_finish(completed=True)
            except StopDownload:
                self.after(0, lambda: self._log("下载已停止\n"))
                self._record_history_finish(completed=False)
            except Exception as exc:
                self.after(0, lambda: self._log(f"下载失败: {exc}\n"))
                self.after(0, lambda: messagebox.showerror("错误", f"下载失败: {exc}"))
                self._record_history_finish(completed=False)
            finally:
                self.download_state["running"] = False
                self.after(0, self._download_done)

        threading.Thread(target=worker, daemon=True).start()

    def _download_file_http(self, repo_id, filename, token, local_path, expected_size):
        if expected_size is not None and os.path.exists(local_path):
            if os.path.getsize(local_path) >= expected_size:
                return

        url = hf_hub_url(repo_id=repo_id, filename=filename)
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        resume_from = 0
        if os.path.exists(local_path):
            resume_from = os.path.getsize(local_path)

        if resume_from > 0:
            headers["Range"] = f"bytes={resume_from}-"

        with requests.get(url, headers=headers, stream=True) as response:
            if response.status_code == 416:
                resume_from = 0
                headers.pop("Range", None)
                with requests.get(url, headers=headers, stream=True) as retry_response:
                    self._write_response(retry_response, local_path, resume_from)
            else:
                self._write_response(response, local_path, resume_from)

    def _write_response(self, response, local_path, resume_from):
        if response.status_code not in {200, 206}:
            raise RuntimeError(f"下载失败: HTTP {response.status_code}")
        mode = "ab" if resume_from > 0 and response.status_code == 206 else "wb"
        if mode == "wb":
            resume_from = 0
        with open(local_path, mode) as f:
            for chunk in response.iter_content(chunk_size=self.download_state.get("chunk_size", 512 * 1024)):
                while self.stop_requested:
                    time.sleep(0.2)
                if chunk:
                    f.write(chunk)

    def _poll_progress(self):
        if not self.download_state["running"]:
            return
        total_bytes = self.download_state["total_bytes"]
        current_path = self.download_state["current_path"]
        current_size = self.download_state["current_size"]
        current_local = self.download_state["current_local"]

        current_bytes = 0
        if current_local and os.path.exists(current_local):
            current_bytes = os.path.getsize(current_local)

        if current_size:
            self.file_progress.configure(mode="determinate", maximum=current_size)
            self.file_progress["value"] = min(current_bytes, current_size)
        else:
            self.file_progress.configure(mode="indeterminate")
            self.file_progress.start(10)

        overall_value = self._calculate_overall_bytes()
        self.download_state["completed_bytes"] = overall_value
        now = time.monotonic()
        last_time = self.download_state.get("last_poll_time")
        last_value = self.download_state.get("last_overall_value", 0)
        if last_time is None:
            speed = 0.0
        else:
            delta_t = max(now - last_time, 0.001)
            speed = max(overall_value - last_value, 0) / delta_t
        self.download_state["last_poll_time"] = now
        self.download_state["last_overall_value"] = overall_value
        self.download_state["last_speed_bps"] = speed
        new_chunk = recommended_chunk_size(speed)
        if new_chunk != self.download_state.get("chunk_size"):
            self.download_state["chunk_size"] = new_chunk
            self.chunk_size_var.set(new_chunk)
            self.chunk_label.configure(text=f"推荐分块: {format_size(new_chunk)}")
        if total_bytes > 0:
            self.overall_progress["value"] = min(overall_value, total_bytes)
            self.overall_label.configure(text=f"总进度: {format_size(overall_value)} / {format_size(total_bytes)}")
            remaining = max(total_bytes - overall_value, 0)
            self.remaining_label.configure(text=f"剩余: {format_size(remaining)}")
        else:
            self.overall_label.configure(text="总进度: 未知")
        self.speed_label.configure(text=f"速度: {format_size(speed)}/s")

        if current_path:
            if current_size:
                self.file_label.configure(
                    text=f"当前文件: {current_path} ({format_size(current_bytes)} / {format_size(current_size)})"
                )
            else:
                self.file_label.configure(text=f"当前文件: {current_path} (大小未知)")

        last_history = self.download_state.get("last_history_time")
        if last_history is None or now - last_history > 1.0:
            self.download_state["last_history_time"] = now
            self._record_history_progress(overall_value)

        self.after(300, self._poll_progress)

    def _download_done(self):
        self.overall_progress.stop()
        self.file_progress.stop()
        self.start_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")
        self.current_session_id = None
        self.stop_requested = False
        self.resume_btn.configure(state="disabled")
        self.speed_label.configure(text="速度: 0 B/s")
        last_speed_bps = self.download_state.get("last_speed_bps")
        if last_speed_bps is not None:
            self.config_data["last_speed_bps"] = last_speed_bps
            self._save_history()
            self.chunk_size_var.set(recommended_chunk_size(last_speed_bps))
            self.chunk_label.configure(text=f"推荐分块: {format_size(self.chunk_size_var.get())}")
        self._refresh_incomplete_list()

    def _log(self, text):
        self.log.configure(state="normal")
        self.log.insert(tk.END, text)
        self.log.see(tk.END)
        self.log.configure(state="disabled")

    def _calculate_overall_bytes(self):
        targets = self.download_state.get("targets") or []
        local_dir = self.download_state.get("local_dir")
        size_map = self.download_state.get("size_map") or {}
        total = 0
        if not local_dir:
            return 0
        for path in targets:
            local_path = os.path.join(local_dir, path)
            if os.path.exists(local_path):
                size = os.path.getsize(local_path)
                expected = size_map.get(path)
                if expected:
                    total += min(size, expected)
                else:
                    total += size
        return total

    def _stop_download(self):
        if not self.download_state["running"]:
            return
        self.stop_requested = True
        self.stop_btn.configure(state="disabled")
        self.resume_btn.configure(state="normal")
        self._log("已暂停\n")

    def _resume_download(self):
        if not self.download_state["running"]:
            return
        self.stop_requested = False
        self.resume_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")
        self._log("继续下载...\n")


if __name__ == "__main__":
    app = WizardApp()
    app.mainloop()
