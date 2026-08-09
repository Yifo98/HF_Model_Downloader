# Security Policy

## Supported versions

The currently maintained release line is:

| Release line | Maintained |
| --- | --- |
| `5.6.x` | Yes |

## Security boundaries

HF Model Downloader handles several sensitive trust boundaries: privileged Electron IPC, renderer-to-main-process separation, remote endpoints and redirects, Hugging Face tokens, local filesystem paths and writes, download integrity and resumption, and application update metadata and artifacts.

The [5.6 security architecture and residual-risk review](docs/security/5.6-review.md) describes the current controls, validation, release boundaries, and known residual risks in more detail.

## Reporting a vulnerability

Do not disclose a suspected vulnerability through a public GitHub issue, discussion, pull request, or other public channel.

Use [GitHub Private Vulnerability Reporting](https://github.com/Yifo98/HF_Model_Downloader/security/advisories/new) to submit a private report or draft Security Advisory. If that mechanism is temporarily unavailable, contact the maintainer privately through a contact method published on the [Yifo98 GitHub profile](https://github.com/Yifo98). Do not guess an email address or include vulnerability details in a public request to establish contact.

A useful report should include:

- the affected version, operating system, and relevant configuration;
- a clear description of the issue, affected trust boundary, and potential impact;
- minimal, safe reproduction steps or a non-destructive proof of concept when available;
- expected and observed behavior;
- sanitized logs, screenshots, or sample data that help reproduce the issue; and
- any known mitigations or suggested remediation, if available.

Do not include credentials, tokens, private paths, private model contents, personal data, or unrelated sensitive material. A weaponized exploit is not required; enough information to understand and reproduce the issue safely is sufficient.

Please coordinate public disclosure with the maintainer so the issue can be validated, remediated, and communicated responsibly. No response or remediation time is guaranteed by this policy.
