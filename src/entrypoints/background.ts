import BookmarkService from '../utils/services'
import WebDAVService from '../utils/webdav'
import { Setting } from '../utils/setting'
import iconLogo from '../assets/icon.png'
import { OperType, BookmarkInfo, SyncDataInfo, RootBookmarksType, BrowserType } from '../utils/models'
import { Bookmarks } from 'wxt/browser'
export default defineBackground(() => {

  const AUTO_SYNC_ALARM_NAME = 'bookmarkhub-auto-sync';
  let autoSyncPending = false; // 标记是否有待同步的变更

  browser.runtime.onInstalled.addListener(c => {
    // 初始化自动同步
    initAutoSync();
  });

  // 启动时也初始化自动同步
  initAutoSync();

  // 监听设置变更，重新配置自动同步
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && (changes.autoSync || changes.autoSyncInterval || changes.syncGithub || changes.syncWebdav)) {
      initAutoSync();
    }
  });

  // 初始化自动同步
  async function initAutoSync() {
    const setting = await Setting.build();

    // 清除现有的定时器
    await browser.alarms.clear(AUTO_SYNC_ALARM_NAME);

    if (setting.autoSync) {
      let canSync = false;
      if (setting.syncGithub && setting.githubToken && setting.gistID) {
        canSync = true;
      }
      if (setting.syncWebdav && setting.webdavUrl && setting.webdavUsername && setting.webdavPassword) {
        canSync = true;
      }

      if (canSync) {
        browser.alarms.create(AUTO_SYNC_ALARM_NAME, {
          periodInMinutes: setting.autoSyncInterval || 30
        });
        console.log(`[BookmarkHub] Auto sync enabled, interval: ${setting.autoSyncInterval} minutes`);
      } else {
        console.log('[BookmarkHub] Auto sync disabled (missing credentials)');
      }
    } else {
      console.log('[BookmarkHub] Auto sync disabled');
    }
  }

  // 监听定时器触发
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_SYNC_ALARM_NAME) {
      const setting = await Setting.build();
      if (setting.autoSync && autoSyncPending) {
        console.log('[BookmarkHub] Auto sync triggered');
        curOperType = OperType.SYNC;
        await uploadBookmarks();
        curOperType = OperType.NONE;
        browser.action.setBadgeText({ text: "" });
        autoSyncPending = false;
      }
    }
  });

  let curOperType = OperType.NONE;
  let curBrowserType = BrowserType.CHROME;
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.name === 'upload') {
      curOperType = OperType.SYNC
      uploadBookmarks().then(() => {
        curOperType = OperType.NONE
        browser.action.setBadgeText({ text: "" });
        refreshLocalCount();
        sendResponse(true);
      });
    }
    if (msg.name === 'download') {
      curOperType = OperType.SYNC
      downloadBookmarks().then(() => {
        curOperType = OperType.NONE
        browser.action.setBadgeText({ text: "" });
        refreshLocalCount();
        sendResponse(true);
      });

    }
    if (msg.name === 'removeAll') {
      curOperType = OperType.REMOVE
      clearBookmarkTree().then(() => {
        curOperType = OperType.NONE
        browser.action.setBadgeText({ text: "" });
        refreshLocalCount();
        sendResponse(true);
      });

    }
    if (msg.name === 'setting') {
      browser.runtime.openOptionsPage().then(() => {
        sendResponse(true);
      });
    }
    // 导出书签 - 获取格式化的书签数据
    if (msg.name === 'getBookmarksForExport') {
      getBookmarks().then(bookmarks => {
        const formattedBookmarks = formatBookmarks(bookmarks);
        sendResponse({
          version: browser.runtime.getManifest().version,
          bookmarks: formattedBookmarks
        });
      });
    }
    // 导入书签 - 从临时存储读取并创建书签
    if (msg.name === 'importBookmarks') {
      importBookmarksFromStorage().then(() => {
        refreshLocalCount();
        sendResponse(true);
      }).catch(err => {
        console.error('Import error:', err);
        sendResponse(false);
      });
    }
    if (msg.name === 'sync') {
      curOperType = OperType.SYNC
      syncBookmarks().then(() => {
        curOperType = OperType.NONE
        browser.action.setBadgeText({ text: "" });
        refreshLocalCount();
        sendResponse(true);
      });
    }
    if (msg.name === 'testGithub') {
      BookmarkService.testConnection().then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, message: err.message }));
    }
    if (msg.name === 'testWebdav') {
      WebDAVService.testConnection().then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, message: err.message }));
    }
    return true;
  });

  // 合并同步书签 (多端同步核心 - 多渠道支持)
  async function syncBookmarks() {
    const results: { service: string, success: boolean, error?: string }[] = [];
    try {
      let setting = await Setting.build();
      const cloudTrees: BookmarkInfo[][] = [];

      // 1. 从所有开启的服务拉取数据
      if (setting.syncGithub) {
        try {
          const githubContent = await BookmarkService.get();
          if (githubContent) {
            const data: SyncDataInfo = JSON.parse(githubContent);
            if (data.bookmarks) cloudTrees.push(data.bookmarks);
          }
          results.push({ service: 'GitHub', success: true });
        } catch (e: any) {
          results.push({ service: 'GitHub', success: false, error: e.message });
        }
      }

      if (setting.syncWebdav) {
        try {
          const webdavContent = await WebDAVService.get();
          if (webdavContent) {
            const data: SyncDataInfo = JSON.parse(webdavContent);
            if (data.bookmarks) cloudTrees.push(data.bookmarks);
          }
          results.push({ service: 'WebDAV', success: true });
        } catch (e: any) {
          results.push({ service: 'WebDAV', success: false, error: e.message });
        }
      }

      const localTree = await getBookmarks();
      const localFormatted = formatBookmarks(localTree) || [];

      // 2. 将所有云端数据合并
      let mergedCloudBookmarks: BookmarkInfo[] = [];
      cloudTrees.forEach(remoteTree => {
        mergedCloudBookmarks = mergeBookmarkTrees(mergedCloudBookmarks, remoteTree);
      });

      // 3. 将云端合并结果与本地合并
      const finalMergedBookmarks = mergeBookmarkTrees(mergedCloudBookmarks, localFormatted);

      // 4. 更新本地
      await clearBookmarkTree();
      await createBookmarkTree(finalMergedBookmarks);

      // 5. 将最终结果推送到所有服务
      const finalSyncData = new SyncDataInfo();
      finalSyncData.version = browser.runtime.getManifest().version;
      finalSyncData.createDate = Date.now();
      finalSyncData.bookmarks = finalMergedBookmarks;
      finalSyncData.browser = navigator.userAgent;

      const uploadTasks = [];
      const jsonContent = JSON.stringify(finalSyncData);

      if (setting.syncGithub) {
        uploadTasks.push(
          BookmarkService.update({
            files: { [setting.gistFileName]: { content: jsonContent } },
            description: setting.gistFileName
          }).catch(e => {
            const res = results.find(r => r.service === 'GitHub');
            if (res) { res.success = false; res.error = e.message; }
          })
        );
      }
      if (setting.syncWebdav) {
        uploadTasks.push(
          WebDAVService.update(jsonContent).catch(e => {
            const res = results.find(r => r.service === 'WebDAV');
            if (res) { res.success = false; res.error = e.message; }
          })
        );
      }

      await Promise.all(uploadTasks);

      const count = getBookmarkCount(finalMergedBookmarks);
      await browser.storage.local.set({ remoteCount: count });

      if (setting.enableNotify) {
        notifyMultiChannel(browser.i18n.getMessage('syncBookmarks'), results);
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      if (results.length > 0) {
        notifyMultiChannel(browser.i18n.getMessage('syncBookmarks'), results);
      } else {
        throw error;
      }
    }
  }

  // 统一多渠道通知函数
  function notifyMultiChannel(title: string, results: { service: string, success: boolean, error?: string }[]) {
    const message = results.map(r =>
      `${r.service}: ${r.success ? '✅' : '❌'}${r.error ? ` (${r.error})` : ''}`
    ).join('\n');

    browser.notifications.create({
      type: "basic",
      iconUrl: iconLogo,
      title: title,
      message: message
    });
  }

  // 辅助函数：合并两个书签树
  function mergeBookmarkTrees(remote: BookmarkInfo[], local: BookmarkInfo[]): BookmarkInfo[] {
    const result = [...remote];

    local.forEach(localNode => {
      // 在 remote 中寻找匹配的节点 (同名文件夹或同 URL 书签)
      const matchIndex = result.findIndex(remoteNode =>
        (localNode.url && remoteNode.url === localNode.url) ||
        (!localNode.url && !remoteNode.url && remoteNode.title === localNode.title)
      );

      if (matchIndex === -1) {
        // 本地有，远程没有 -> 加入
        result.push(localNode);
      } else if (!localNode.url && localNode.children && result[matchIndex].children) {
        // 都是文件夹 -> 递归合并子节点
        result[matchIndex].children = mergeBookmarkTrees(result[matchIndex].children || [], localNode.children);
      }
    });

    return result;
  }
  browser.bookmarks.onCreated.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      // console.log("onCreated", id, info)
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      refreshLocalCount();
      autoSyncPending = true; // 标记有待同步的变更
    }
  });
  browser.bookmarks.onChanged.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      // console.log("onChanged", id, info)
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      autoSyncPending = true; // 标记有待同步的变更
    }
  })
  browser.bookmarks.onMoved.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      // console.log("onMoved", id, info)
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      autoSyncPending = true; // 标记有待同步的变更
    }
  })
  browser.bookmarks.onRemoved.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      // console.log("onRemoved", id, info)
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      refreshLocalCount();
      autoSyncPending = true; // 标记有待同步的变更
    }
  })

  async function uploadBookmarks() {
    const results: { service: string, success: boolean, error?: string }[] = [];
    try {
      let setting = await Setting.build()
      let bookmarks = await getBookmarks();
      let syncdata = new SyncDataInfo();
      syncdata.version = browser.runtime.getManifest().version;
      syncdata.createDate = Date.now();
      syncdata.bookmarks = formatBookmarks(bookmarks);
      syncdata.browser = navigator.userAgent;

      const uploadTasks = [];
      const jsonContent = JSON.stringify(syncdata);

      if (setting.syncGithub) {
        if (setting.githubToken == '') throw new Error("Gist Token Not Found");
        if (setting.gistID == '') throw new Error("Gist ID Not Found");

        uploadTasks.push(
          BookmarkService.update({
            files: { [setting.gistFileName]: { content: jsonContent } },
            description: setting.gistFileName
          }).then(() => results.push({ service: 'GitHub', success: true }))
            .catch(e => results.push({ service: 'GitHub', success: false, error: e.message }))
        );
      }

      if (setting.syncWebdav) {
        if (setting.webdavUrl == '') throw new Error("WebDAV URL Not Found");
        uploadTasks.push(
          WebDAVService.update(jsonContent)
            .then(() => results.push({ service: 'WebDAV', success: true }))
            .catch(e => results.push({ service: 'WebDAV', success: false, error: e.message }))
        );
      }

      if (uploadTasks.length === 0) {
        throw new Error("No sync service enabled");
      }

      await Promise.all(uploadTasks);

      const count = getBookmarkCount(syncdata.bookmarks);
      await browser.storage.local.set({ remoteCount: count });

      if (setting.enableNotify) {
        notifyMultiChannel(browser.i18n.getMessage('uploadBookmarks'), results);
      }

    }
    catch (error: any) {
      console.error(error);
      if (results.length > 0) {
        notifyMultiChannel(browser.i18n.getMessage('uploadBookmarks'), results);
      } else {
        browser.notifications.create({
          type: "basic",
          iconUrl: iconLogo,
          title: browser.i18n.getMessage('uploadBookmarks'),
          message: `${browser.i18n.getMessage('error')}：${error.message}`
        });
      }
    }
  }

  async function downloadBookmarks() {
    const results: { service: string, success: boolean, error?: string }[] = [];
    try {
      let setting = await Setting.build()
      const cloudTrees: BookmarkInfo[][] = [];
      const downloadTasks = [];

      if (setting.syncGithub) {
        downloadTasks.push(
          BookmarkService.get()
            .then(content => {
              if (content) {
                const data: SyncDataInfo = JSON.parse(content);
                if (data.bookmarks) cloudTrees.push(data.bookmarks);
                results.push({ service: 'GitHub', success: true });
              } else {
                results.push({ service: 'GitHub', success: false, error: 'File Not Found' });
              }
            })
            .catch(e => results.push({ service: 'GitHub', success: false, error: e.message }))
        );
      }

      if (setting.syncWebdav) {
        downloadTasks.push(
          WebDAVService.get()
            .then(content => {
              if (content) {
                const data: SyncDataInfo = JSON.parse(content);
                if (data.bookmarks) cloudTrees.push(data.bookmarks);
                results.push({ service: 'WebDAV', success: true });
              } else {
                results.push({ service: 'WebDAV', success: false, error: 'File Not Found' });
              }
            })
            .catch(e => results.push({ service: 'WebDAV', success: false, error: e.message }))
        );
      }

      if (downloadTasks.length === 0) {
        throw new Error("No sync service enabled");
      }

      await Promise.all(downloadTasks);

      if (cloudTrees.length > 0) {
        // 合并所有云端来源
        let mergedCloudBookmarks: BookmarkInfo[] = [];
        cloudTrees.forEach(tree => {
          mergedCloudBookmarks = mergeBookmarkTrees(mergedCloudBookmarks, tree);
        });

        await clearBookmarkTree();
        await createBookmarkTree(mergedCloudBookmarks);
        const count = getBookmarkCount(mergedCloudBookmarks);
        await browser.storage.local.set({ remoteCount: count });

        if (setting.enableNotify) {
          notifyMultiChannel(browser.i18n.getMessage('downloadBookmarks'), results);
        }
      }
      else {
        notifyMultiChannel(browser.i18n.getMessage('downloadBookmarks'), results);
      }
    }
    catch (error: any) {
      console.error(error);
      if (results.length > 0) {
        notifyMultiChannel(browser.i18n.getMessage('downloadBookmarks'), results);
      } else {
        browser.notifications.create({
          type: "basic",
          iconUrl: iconLogo,
          title: browser.i18n.getMessage('downloadBookmarks'),
          message: `${browser.i18n.getMessage('error')}：${error.message}`
        });
      }
    }
  }

  async function getBookmarks() {
    let bookmarkTree: BookmarkInfo[] = await browser.bookmarks.getTree();
    if (bookmarkTree && bookmarkTree[0].id === "root________") {
      curBrowserType = BrowserType.FIREFOX;
    }
    else {
      curBrowserType = BrowserType.CHROME;
    }
    return bookmarkTree;
  }

  async function clearBookmarkTree() {
    try {
      let setting = await Setting.build()
      let bookmarks = await getBookmarks();
      let tempNodes: BookmarkInfo[] = [];
      bookmarks[0].children?.forEach(c => {
        c.children?.forEach(d => {
          tempNodes.push(d)
        })
      });
      if (tempNodes.length > 0) {
        for (let node of tempNodes) {
          if (node.id) {
            await browser.bookmarks.removeTree(node.id)
          }
        }
      }
      if (curOperType === OperType.REMOVE && setting.enableNotify) {
        await browser.notifications.create({
          type: "basic",
          iconUrl: iconLogo,
          title: browser.i18n.getMessage('removeAllBookmarks'),
          message: browser.i18n.getMessage('success')
        });
      }
    }
    catch (error: any) {
      console.error(error);
      await browser.notifications.create({
        type: "basic",
        iconUrl: iconLogo,
        title: browser.i18n.getMessage('removeAllBookmarks'),
        message: `${browser.i18n.getMessage('error')}：${error.message}`
      });
    }
  }

  async function createBookmarkTree(bookmarkList: BookmarkInfo[] | undefined) {
    if (bookmarkList == null) {
      return;
    }
    for (let i = 0; i < bookmarkList.length; i++) {
      let node = bookmarkList[i];
      if (node.title == RootBookmarksType.MenuFolder
        || node.title == RootBookmarksType.MobileFolder
        || node.title == RootBookmarksType.ToolbarFolder
        || node.title == RootBookmarksType.UnfiledFolder) {
        if (curBrowserType == BrowserType.FIREFOX) {
          switch (node.title) {
            case RootBookmarksType.MenuFolder:
              node.children?.forEach(c => c.parentId = "menu________");
              break;
            case RootBookmarksType.MobileFolder:
              node.children?.forEach(c => c.parentId = "mobile______");
              break;
            case RootBookmarksType.ToolbarFolder:
              node.children?.forEach(c => c.parentId = "toolbar_____");
              break;
            case RootBookmarksType.UnfiledFolder:
              node.children?.forEach(c => c.parentId = "unfiled_____");
              break;
            default:
              node.children?.forEach(c => c.parentId = "unfiled_____");
              break;
          }
        } else {
          switch (node.title) {
            case RootBookmarksType.MobileFolder:
              node.children?.forEach(c => c.parentId = "3");
              break;
            case RootBookmarksType.ToolbarFolder:
              node.children?.forEach(c => c.parentId = "1");
              break;
            case RootBookmarksType.UnfiledFolder:
            case RootBookmarksType.MenuFolder:
              node.children?.forEach(c => c.parentId = "2");
              break;
            default:
              node.children?.forEach(c => c.parentId = "2");
              break;
          }
        }
        await createBookmarkTree(node.children);
        continue;
      }

      let res: Bookmarks.BookmarkTreeNode = { id: '', title: '' };
      try {
        /* 处理firefox中创建 chrome://chrome-urls/ 格式的书签会报错的问题 */
        res = await browser.bookmarks.create({
          parentId: node.parentId,
          title: node.title,
          url: node.url
        });
      } catch (err) {
        console.error(res, err);
      }
      if (res.id && node.children && node.children.length > 0) {
        node.children.forEach(c => c.parentId = res.id);
        await createBookmarkTree(node.children);
      }
    }
  }

  function getBookmarkCount(bookmarkList: BookmarkInfo[] | undefined) {
    let count = 0;
    if (bookmarkList) {
      bookmarkList.forEach(c => {
        if (c.url) {
          count = count + 1;
        }
        else {
          count = count + getBookmarkCount(c.children);
        }
      });
    }
    return count;
  }

  async function refreshLocalCount() {
    let bookmarkList = await getBookmarks();
    const count = getBookmarkCount(bookmarkList);
    await browser.storage.local.set({ localCount: count });
  }


  function formatBookmarks(bookmarks: BookmarkInfo[]): BookmarkInfo[] | undefined {
    if (bookmarks[0].children) {
      for (let a of bookmarks[0].children) {
        switch (a.id) {
          case "1":
          case "toolbar_____":
            a.title = RootBookmarksType.ToolbarFolder;
            break;
          case "menu________":
            a.title = RootBookmarksType.MenuFolder;
            break;
          case "2":
          case "unfiled_____":
            a.title = RootBookmarksType.UnfiledFolder;
            break;
          case "3":
          case "mobile______":
            a.title = RootBookmarksType.MobileFolder;
            break;
        }
      }
    }

    let a = format(bookmarks[0]);
    return a.children;
  }

  function format(b: BookmarkInfo): BookmarkInfo {
    b.dateAdded = undefined;
    b.dateGroupModified = undefined;
    b.id = undefined;
    b.index = undefined;
    b.parentId = undefined;
    b.type = undefined;
    b.unmodifiable = undefined;
    if (b.children && b.children.length > 0) {
      b.children?.map(c => format(c))
    }
    return b;
  }
  ///暂时不启用自动备份
  /*
  async function backupToLocalStorage(bookmarks: BookmarkInfo[]) {
      try {
          let syncdata = new SyncDataInfo();
          syncdata.version = browser.runtime.getManifest().version;
          syncdata.createDate = Date.now();
          syncdata.bookmarks = formatBookmarks(bookmarks);
          syncdata.browser = navigator.userAgent;
          const keyname = 'BookmarkHub_backup_' + Date.now().toString();
          await browser.storage.local.set({ [keyname]: JSON.stringify(syncdata) });
      }
      catch (error:any) {
          console.error(error)
      }
  }
  */

  // 从临时存储导入书签
  async function importBookmarksFromStorage() {
    try {
      const data = await browser.storage.local.get('pendingImport');
      const importData = data.pendingImport;

      if (!importData || !importData.bookmarks) {
        throw new Error('No import data found');
      }

      curOperType = OperType.SYNC;

      // 先清空现有书签
      await clearBookmarkTree();

      // 创建导入的书签
      await createBookmarkTree(importData.bookmarks);

      // 清理临时存储
      await browser.storage.local.remove('pendingImport');

      curOperType = OperType.NONE;
      browser.action.setBadgeText({ text: "" });

      // 发送通知
      let setting = await Setting.build();
      if (setting.enableNotify) {
        await browser.notifications.create({
          type: "basic",
          iconUrl: iconLogo,
          title: browser.i18n.getMessage('importBookmarks'),
          message: browser.i18n.getMessage('success')
        });
      }
    } catch (error: any) {
      curOperType = OperType.NONE;
      console.error('Import error:', error);
      await browser.notifications.create({
        type: "basic",
        iconUrl: iconLogo,
        title: browser.i18n.getMessage('importBookmarks'),
        message: `${browser.i18n.getMessage('error')}：${error.message}`
      });
      throw error;
    }
  }

});