# Burp Mobile

Burp Suite Style Logger & Repeater Extension for Mobile Browsers



## How it works

**Logger** hooks fetch/XMLHttpRequest inside the page itself, so it sees every request the page makes as it happens.

**Repeater** replays from the background service worker instead of the page — so it isn't blocked by the target's cors policy, and origin/referer/cookie are set to match the real target instead of leaking the extension's own origin.



## Installation

### 1 - Download Lemur Browser (Recomended)
<img src="https://github.com/sudokage-sh/burp-mobile/blob/main/images/download_lemur.jpg" width="350" alt="Download Lemur">

---
### 2 - Download Extension
[Download the .zip file from here](https://github.com/sudokage-sh/burp-mobile/blob/53d1cc1633fb918516b3018bc7ddb7753a277a81/burp-mobile.zip)

---
### 3 - Open Lemur Browser → Extensions → Load .zip File
<img src="https://github.com/sudokage-sh/burp-mobile/blob/main/images/load_to_lemur.jpg" width="350" alt="Load Extension">



## Usage

Visit the target page and click the burp-mobile button in the extensions tab.

<img src="https://github.com/sudokage-sh/burp-mobile/blob/main/images/burp_ready.jpg" width="350" alt="Burp Ready">

You will see two options: Logger and Repeater. 

If you are familiar with Burp, you already know the rest.

| Logger Screen | Request & Response | Repeater Screen |
| :---: | :---: | :---: |
| <img src="https://github.com/sudokage-sh/burp-mobile/blob/main/images/logger.jpg" width="250"> | <img src="https://github.com/sudokage-sh/burp-mobile/blob/main/images/req_and_res.jpg" width="250"> | <img src="https://github.com/sudokage-sh/burp-mobile/blob/main/images/repeater.jpg" width="250"> |



## Disclaimer
For authorized security testing and research only. 

Use responsibly and only on targets you have permission to test.
