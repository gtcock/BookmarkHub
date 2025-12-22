<!-- PROJECT LOGO -->
<br />
<p align="center">
  <a href="https://github.com/iwvw/BookmarkHub">
    <img src="images/icon128.png" alt="BookmarkHub" width="80" height="80">
  </a>

  <h1 align="center">BookmarkHub</h1>

  <p align="center">
    <b>简约、安全、强大的跨浏览器书签同步方案</b>
    <br />
    <br />
    <a href="https://github.com/iwvw/BookmarkHub/issues">报告 Bug</a>
    ·
    <a href="https://github.com/iwvw/BookmarkHub/issues">提交建议</a>
  </p>
</p>

---

## 🚀 路线图 (TODO)

- [x] **自动同步**：实时监听书签变更，智能合并上传
- [x] **WebDAV 支持**：支持坚果云、Alist、Nextcloud 等私有云存储
- [x] **多版本备份**：WebDAV 循环备份机制，数据安全无忧
- [x] **导入/导出**：支持本地 JSON 文件的便捷导入与备份
- [x] **容灾机制**：测试连接功能，确保服务时刻在线
- [ ] **移动端支持**：为移动浏览器提供同步能力
- [ ] **分享功能**：通过加密链接一键分享书签集
- [x] **主题自适应**：智能跟随系统深色模式

---

<!-- TABLE OF CONTENTS -->
<details open="open">
  <summary><h2 style="display: inline-block">目录</h2></summary>
  <ul>
    <li><a href="#关于项目">关于项目</a></li>
    <li><a href="#核心功能">核心功能</a></li>
    <li><a href="#下载安装">下载安装</a></li>
    <li><a href="#使用方法">使用方法</a></li>
    <li><a href="#开源协议">开源协议</a></li>
    <li><a href="#联系开发者">联系开发者</a></li>
  </ul>
</details>

---

<a name="关于项目"></a>
## 📖 关于项目

**BookmarkHub** 是一款专为极客和多设备使用者设计的浏览器插件。它打破了浏览器之间的生态壁垒，让你在不同品牌、不同设备（Chrome、Firefox、Microsoft Edge 等）之间无缝流转书签。

它使用 **GitHub Gist** 或 **WebDAV** 作为私有存储媒介，不依赖第三方中间服务器，确保你的数据隐私与安全。

![展示图](images/3.gif)

<div align="center">
  <img src="images/1.png" width="45%" />
  <img src="images/2.png" width="45%" />
</div>

---

<a name="核心功能"></a>
## ✨ 核心功能

*   **零账号门槛**：无需注册，直接使用 GitHub Gist 或 WebDAV 凭据。
*   **一键云同步**：极速上传/下载，支持增量合并同步。
*   **本地管理**：提供快速清理本地冗余书签的功能。
*   **多环境支持**：完美支持不同电脑、不同内核的浏览器互传。
*   **状态透明**：实时显示本地与远程书签数量，差异一目了然。
*   **数据安全**：WebDAV 支持多版本备份（默认 5 份历史存档）。

---

<a name="下载安装"></a>
## 📦 下载安装

> **注意**：使用 GitHub 存储需要有 GitHub 账号并配置 Gist 权限；WebDAV 则需要你有相应的云服务器地址。

### ⬇️ 快捷下载
**[📦 下载最新版本 (Chrome/Edge)](https://github.com/iwvw/BookmarkHub/releases/latest/download/bookmarkhub-chrome.zip)**

### 应用商店
*   [Chrome 网上应用店](https://chrome.google.com/webstore/detail/bookmarkhub-sync-bookmark/fohimdklhhcpcnpmmichieidclgfdmol)
*   [Firefox 附加组件](https://addons.mozilla.org/zh-CN/firefox/addon/BookmarkHub/)
*   [Microsoft Edge 外接程序](https://microsoftedge.microsoft.com/addons/detail/BookmarkHub/fdnmfpogadcljhecfhdikdecbkggfmgk)
*   **Chromium 内核浏览器**：可通过 Chrome 应用商店手动安装。

---

<a name="使用方法"></a>
## 🛠 使用方法

1.  **登录 GitHub**：[GitHub.com](https://github.com/login)。
2.  **申请 Token**：[创建管理 Gist 的 Token](https://github.com/settings/tokens/new)（需选中 `gist` 权限）。
3.  **创建 Gist**：[创建一个名为 BookmarkHub 的私有 Gist](https://gist.github.com)。*强烈建议设为私有！*
4.  **配置插件**：
    *   在插件设置页填入填入 **GitHub Token** 和 **Gist ID**。
    *   或者开启 **WebDAV** 配置。
5.  **开始同步**：点击“合并同步”即可将本地与云端数据完美融合。

---

<a name="开源协议"></a>
## 📄 开源协议

基于 **MIT License**。详情请参阅 `LICENSE` 文件。

---

<a name="联系开发者"></a>
## 🤝 联系开发者

**iwvw**

*   项目地址: [https://github.com/iwvw/BookmarkHub](https://github.com/iwvw/BookmarkHub)
*   如果您觉得好用，欢迎给一个 **Star** ⭐️，这是对开发者最大的鼓励！
