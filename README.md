# Mi Compensación · Close the day

Unofficial Chrome extension that helps you **close and edit workdays** on
[Mi Compensación](https://micompensacion.com) using the SSO session you already
have open in the browser.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Not affiliated** with Compensa, Mi Compensación, or any employer.
> This is a personal, unofficial helper. Use it only if your workplace policy
> allows automating the portal UI.

## Features

- Side panel calendar for the selected month
- Highlights missing or incomplete days (gaps)
- Close or edit one or many days with your preferred schedule
- Remembers the last schedule you submitted as the default
- Uses the portal session already open — **does not store your password**

## Install (Chrome / Chromium)

1. Clone this repository (or download the ZIP and unpack it).
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the **repository root** (the folder that
   contains `manifest.json`).
5. Pin the extension if you want quick access to the side panel.

## Usage

1. Sign in to [micompensacion.com](https://micompensacion.com) in a normal tab
   (complete SSO as usual).
2. Open the extension side panel.
3. Refresh the month view.
4. Select the day(s) you want to close or edit.
5. Confirm the schedule (entry / exit / pause) and submit.

The extension talks to the portal from your browser using your existing session
cookies. The last successful schedule becomes the default for the next run.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `storage` | Save your preferred schedule and UI preferences locally |
| `sidePanel` | Show the calendar UI in Chrome’s side panel |
| `tabs` | Find an open Mi Compensación tab with an active session |
| `scripting` | Inject the content script that reads/writes portal pages |
| `webNavigation` | Detect portal navigation so the panel stays in sync |
| Host access to `https://*.micompensacion.com/*` | Call the portal APIs from pages on that domain only |

## Verify (offline)

No npm install is required. With [Node.js](https://nodejs.org/) 18+:

```bash
node fixtures/verify.mjs
node fixtures/verify-finalizar.mjs
node fixtures/verify-batch-edit.mjs
node fixtures/verify-mis-registros.mjs
```

These scripts exercise parsing and payload helpers against local HTML fixtures.
They do not call the live portal.

## Privacy

- Credentials and passwords are **not** collected or stored by the extension.
- Requests use `credentials: 'include'` so the browser attaches the cookies from
  your already-authenticated portal tab.
- Settings (for example schedule defaults) are stored in
  `chrome.storage.local` on your machine.
- The extension does not send data to third-party analytics or backends.

## Disclaimer

- Use at your own risk.
- Respect your employer’s policies and the portal’s terms of use.
- Portal HTML and endpoints can change without notice; the extension may break
  or behave incorrectly after a portal update.
- Submitting incorrect times can affect HR records. Double-check before
  confirming batch updates.

## License

MIT — see [LICENSE](LICENSE).
