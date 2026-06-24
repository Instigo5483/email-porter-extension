# Email Porter

A Chrome extension that lets you share emails from Gmail or Outlook directly to Discord or WhatsApp Web — in one click.

![Email Porter Icon](icons/icon128.png)

## Features

- **Share to Discord** — pick a server and channel from inside the extension; long emails are automatically split into multiple messages; file attachments are uploaded directly
- **Share to WhatsApp** — opens WhatsApp Web with the email pre-filled
- **Per-email selection** — when a thread has multiple emails open, choose exactly which one to share
- **Gmail ⋮ menu integration** — a "Share Email" option is injected into Gmail's per-message menu so you can share without opening the popup
- **Hide sender & recipient** — optionally strip From/To fields before sharing
- **Attachment support** — email attachments are fetched and forwarded to Discord (up to 7 MB per file)
- **Email PDF** — a formatted PDF of the email (identical to Gmail's "Save as PDF") is automatically attached to every Discord share

## Supported Platforms

| Email | Destinations |
|-------|-------------|
| Gmail | Discord, WhatsApp Web |
| Outlook Web | Discord, WhatsApp Web |

## Installation

### From the Chrome Web Store
*(Coming soon)*

### Manual / Developer Install
1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder
5. Open Gmail or Outlook Web — the extension is ready

## Usage

### From the extension popup
1. Open an email in Gmail or Outlook
2. Click the Email Porter icon in your toolbar
3. Choose **Share to Discord** or **Share to WhatsApp**
4. If the thread has multiple emails, pick which one to share
5. For Discord: select a server → select a channel → sent!

### From Gmail's message menu
1. Open an email and click the **⋮** (more options) button on any message
2. Click **Share Email**
3. Choose Discord or WhatsApp from the overlay
4. For Discord: select server → channel → done

## Permissions

| Permission | Why it's needed |
|-----------|----------------|
| `activeTab` | Read the current email tab |
| `tabs` | Detect open Discord tabs for token reading |
| `scripting` | Inject content scripts to extract email content |
| `storage` | Save your Hide Sender preference |
| `clipboardWrite` | Copy email text to clipboard |
| `debugger` | Generate a PDF of the email using Chrome's built-in print engine |

## Notes

- Discord sharing requires you to be **logged into Discord Web** (discord.com) in the same browser — the desktop app alone is not enough
- File attachments over 7 MB are skipped (Discord's free-tier upload limit)
- Discord messages over 2000 characters are automatically split and sent in sequence
- When sharing to Discord, a PDF of the email is automatically generated and attached — this briefly opens a background tab that closes on its own

## License

MIT — see [LICENSE](LICENSE)
