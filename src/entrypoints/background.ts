import BookmarkService from '../utils/services'
import WebDAVService from '../utils/webdav'
import { Setting } from '../utils/setting'
import iconLogo from '../assets/icon.png'
import { OperType, BookmarkInfo, SyncDataInfo, RootBookmarksType, BrowserType } from '../utils/models'
import { Bookmarks } from 'wxt/browser'

type RootTypeValue = RootBookmarksType | 'bookmark_bar' | 'other' | 'mobile' | 'menu' | undefined;
type BookmarkNodeWithRoot = BookmarkInfo & { rootType?: RootTypeValue };

export default defineBackground(() => {
  const AUTO_SYNC_ALARM_NAME = 'bookmarkhub-auto-sync';
  let autoSyncPending = false; // 标记是否有待同步的变更

  browser.runtime.onInstalled.addListener(() => {
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
        await uploadBookmarks(setting.autoSyncNotify);
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
      const setting = await Setting.build();
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
      let finalMergedBookmarks = mergeBookmarkTrees(mergedCloudBookmarks, localFormatted);

      // 3.1 纠偏：避免“其他书签里套书签栏/其他书签”
      finalMergedBookmarks = normalizeImportedRoots(finalMergedBookmarks);

      // 4. 更新本地
      await clearBookmarkTree();
      await createBookmarkTree(finalMergedBookmarks);

      // 4.5 预热图标
      if (setting.fetchFavicon) {
        prefetchFavicons(finalMergedBookmarks);
      }

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

      const count = getBookmarkCount(finalSyncData.bookmarks);
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
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      refreshLocalCount();
      autoSyncPending = true;
    }
  });

  browser.bookmarks.onChanged.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      autoSyncPending = true;
    }
  })

  browser.bookmarks.onMoved.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      autoSyncPending = true;
    }
  })

  browser.bookmarks.onRemoved.addListener((id, info) => {
    if (curOperType === OperType.NONE) {
      browser.action.setBadgeText({ text: "!" });
      browser.action.setBadgeBackgroundColor({ color: "#F00" });
      refreshLocalCount();
      autoSyncPending = true;
    }
  })

  async function uploadBookmarks(showNotify?: boolean) {
    const results: { service: string, success: boolean, error?: string }[] = [];
    try {
      const setting = await Setting.build()
      const bookmarks = await getBookmarks();
      const syncdata = new SyncDataInfo();
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

      const shouldNotify = showNotify !== undefined ? showNotify : setting.enableNotify;
      if (shouldNotify) {
        notifyMultiChannel(browser.i18n.getMessage('uploadBookmarks'), results);
      }

    } catch (error: any) {
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
      const setting = await Setting.build()
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
        let mergedCloudBookmarks: BookmarkInfo[] = [];
        cloudTrees.forEach(tree => {
          mergedCloudBookmarks = mergeBookmarkTrees(mergedCloudBookmarks, tree);
        });

        // 下载后先纠偏
        mergedCloudBookmarks = normalizeImportedRoots(mergedCloudBookmarks);

        await clearBookmarkTree();
        await createBookmarkTree(mergedCloudBookmarks);

        if (setting.fetchFavicon) {
          prefetchFavicons(mergedCloudBookmarks);
        }

        const count = getBookmarkCount(mergedCloudBookmarks);
        await browser.storage.local.set({ remoteCount: count });

        if (setting.enableNotify) {
          notifyMultiChannel(browser.i18n.getMessage('downloadBookmarks'), results);
        }
      }
      else {
        notifyMultiChannel(browser.i18n.getMessage('downloadBookmarks'), results);
      }
    } catch (error: any) {
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
    const bookmarkTree: BookmarkInfo[] = await browser.bookmarks.getTree();
    if (bookmarkTree && bookmarkTree[0].id === "root________") {
      curBrowserType = BrowserType.FIREFOX;
    } else {
      curBrowserType = BrowserType.CHROME;
    }
    return bookmarkTree;
  }

  async function clearBookmarkTree() {
    try {
      const setting = await Setting.build()
      const bookmarks = await getBookmarks();
      const tempNodes: BookmarkInfo[] = [];
      bookmarks[0].children?.forEach(c => {
        c.children?.forEach(d => {
          tempNodes.push(d)
        })
      });
      if (tempNodes.length > 0) {
        for (const node of tempNodes) {
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
    } catch (error: any) {
      console.error(error);
      await browser.notifications.create({
        type: "basic",
        iconUrl: iconLogo,
        title: browser.i18n.getMessage('removeAllBookmarks'),
        message: `${browser.i18n.getMessage('error')}：${error.message}`
      });
    }
  }

  function normalizeRootType(raw?: string): RootTypeValue {
    if (!raw) return undefined;
    const t = String(raw).toLowerCase().trim();

    if (
      t === RootBookmarksType.ToolbarFolder.toLowerCase() ||
      t === 'bookmark_bar' ||
      t === 'toolbar' ||
      t === 'bookmarks bar' ||
      t === '书签栏'
    ) return RootBookmarksType.ToolbarFolder;

    if (
      t === RootBookmarksType.UnfiledFolder.toLowerCase() ||
      t === 'other' ||
      t === 'other bookmarks' ||
      t === 'unfiled' ||
      t === '其他书签'
    ) return RootBookmarksType.UnfiledFolder;

    if (
      t === RootBookmarksType.MobileFolder.toLowerCase() ||
      t === 'mobile' ||
      t === 'mobile bookmarks' ||
      t === '移动书签'
    ) return RootBookmarksType.MobileFolder;

    if (
      t === RootBookmarksType.MenuFolder.toLowerCase() ||
      t === 'menu' ||
      t === 'bookmarks menu' ||
      t === '书签菜单'
    ) return RootBookmarksType.MenuFolder;

    return undefined;
  }

  // 纠偏：把“其他书签里嵌套的书签栏/其他书签”提升为根层
  function normalizeImportedRoots(bookmarkList: BookmarkInfo[] | undefined): BookmarkInfo[] {
    if (!bookmarkList || bookmarkList.length === 0) return [];

    // 深拷贝，避免副作用
    const nodes = JSON.parse(JSON.stringify(bookmarkList)) as BookmarkNodeWithRoot[];

    const rootBuckets = {
      toolbar: undefined as BookmarkNodeWithRoot | undefined,
      unfiled: undefined as BookmarkNodeWithRoot | undefined,
      mobile: undefined as BookmarkNodeWithRoot | undefined,
      menu: undefined as BookmarkNodeWithRoot | undefined
    };

    const others: BookmarkNodeWithRoot[] = [];

    const getBucketKey = (node: BookmarkNodeWithRoot): keyof typeof rootBuckets | undefined => {
      const byRootType = normalizeRootType(String(node.rootType || ''));
      const byTitle = normalizeRootType(node.title || '');

      const v = byRootType || byTitle;
      if (!v) return undefined;
      if (v === RootBookmarksType.ToolbarFolder) return 'toolbar';
      if (v === RootBookmarksType.UnfiledFolder) return 'unfiled';
      if (v === RootBookmarksType.MobileFolder) return 'mobile';
      if (v === RootBookmarksType.MenuFolder) return 'menu';
      return undefined;
    };

    const upsertRootNode = (incoming: BookmarkNodeWithRoot) => {
      const key = getBucketKey(incoming);
      if (!key) {
        others.push(incoming);
        return;
      }

      // 统一根节点 title/rootType
      if (key === 'toolbar') {
        incoming.title = RootBookmarksType.ToolbarFolder;
        incoming.rootType = RootBookmarksType.ToolbarFolder;
      } else if (key === 'unfiled') {
        incoming.title = RootBookmarksType.UnfiledFolder;
        incoming.rootType = RootBookmarksType.UnfiledFolder;
      } else if (key === 'mobile') {
        incoming.title = RootBookmarksType.MobileFolder;
        incoming.rootType = RootBookmarksType.MobileFolder;
      } else if (key === 'menu') {
        incoming.title = RootBookmarksType.MenuFolder;
        incoming.rootType = RootBookmarksType.MenuFolder;
      }

      const existing = rootBuckets[key];
      if (!existing) {
        rootBuckets[key] = incoming;
      } else {
        existing.children = mergeBookmarkTrees(existing.children || [], incoming.children || []) as BookmarkInfo[];
      }
    };

    // 先处理顶层
    for (const n of nodes) {
      upsertRootNode(n);
    }

    // 处理“其他书签里套根目录”
    const unfiled = rootBuckets.unfiled;
    if (unfiled?.children?.length) {
      const remain: BookmarkNodeWithRoot[] = [];

      for (const child of unfiled.children as BookmarkNodeWithRoot[]) {
        const key = getBucketKey(child);
        if (key) {
          upsertRootNode(child);
        } else {
          remain.push(child);
        }
      }

      unfiled.children = remain;
    }

    const finalList: BookmarkNodeWithRoot[] = [];
    if (rootBuckets.toolbar) finalList.push(rootBuckets.toolbar);
    if (rootBuckets.unfiled) finalList.push(rootBuckets.unfiled);
    if (rootBuckets.mobile) finalList.push(rootBuckets.mobile);
    if (rootBuckets.menu) finalList.push(rootBuckets.menu);
    finalList.push(...others);

    return finalList as BookmarkInfo[];
  }

  async function createBookmarkTree(bookmarkList: BookmarkInfo[] | undefined) {
    if (bookmarkList == null) return;

    for (let i = 0; i < bookmarkList.length; i++) {
      const node = bookmarkList[i] as BookmarkNodeWithRoot;

      const rootByType = normalizeRootType(String(node.rootType || ''));
      const rootByTitle = normalizeRootType(node.title || '');
      const rootType = rootByType || rootByTitle;

      const isRootFolder = !!rootType && !node.url;

      if (isRootFolder) {
        if (curBrowserType == BrowserType.FIREFOX) {
          let parentId = "unfiled_____";
          switch (rootType) {
            case RootBookmarksType.MenuFolder:
              parentId = "menu________";
              break;
            case RootBookmarksType.MobileFolder:
              parentId = "mobile______";
              break;
            case RootBookmarksType.ToolbarFolder:
              parentId = "toolbar_____";
              break;
            case RootBookmarksType.UnfiledFolder:
            default:
              parentId = "unfiled_____";
              break;
          }
          node.children?.forEach(c => c.parentId = parentId);
        } else {
          let parentId = "2";
          switch (rootType) {
            case RootBookmarksType.MobileFolder:
              parentId = "3";
              break;
            case RootBookmarksType.ToolbarFolder:
              parentId = "1";
              break;
            case RootBookmarksType.UnfiledFolder:
            case RootBookmarksType.MenuFolder:
            default:
              parentId = "2";
              break;
          }
          node.children?.forEach(c => c.parentId = parentId);
        }

        await createBookmarkTree(node.children);
        continue;
      }

      let res: Bookmarks.BookmarkTreeNode = { id: '', title: '' };
      try {
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
        } else {
          count = count + getBookmarkCount(c.children);
        }
      });
    }
    return count;
  }

  async function refreshLocalCount() {
    const bookmarkList = await getBookmarks();
    const count = getBookmarkCount(bookmarkList);
    await browser.storage.local.set({ localCount: count });
  }

  // 关键修复：不修改原始树，深拷贝 + 新对象输出 + rootType稳定映射
  function formatBookmarks(bookmarks: BookmarkInfo[]): BookmarkInfo[] | undefined {
    if (!bookmarks?.[0]) return [];

    const root = JSON.parse(JSON.stringify(bookmarks[0])) as BookmarkNodeWithRoot;

    // 根层打 rootType 标记（不改展示 title）
    if (root.children) {
      for (const child of root.children as BookmarkNodeWithRoot[]) {
        switch (child.id) {
          case "1":
          case "toolbar_____":
            child.rootType = RootBookmarksType.ToolbarFolder;
            break;
          case "menu________":
            child.rootType = RootBookmarksType.MenuFolder;
            break;
          case "2":
          case "unfiled_____":
            child.rootType = RootBookmarksType.UnfiledFolder;
            break;
          case "3":
          case "mobile______":
            child.rootType = RootBookmarksType.MobileFolder;
            break;
          default:
            child.rootType = normalizeRootType(child.title || '');
            break;
        }
      }
    }

    const normalized = format(root) as BookmarkNodeWithRoot;
    return normalized.children;
  }

  function format(b: BookmarkNodeWithRoot): BookmarkNodeWithRoot {
    const out: BookmarkNodeWithRoot = {
      title: b.title,
      url: b.url
    };

    if (b.rootType) out.rootType = b.rootType;

    if (b.children && b.children.length > 0) {
      out.children = b.children.map(c => format(c as BookmarkNodeWithRoot));
    }

    return out;
  }

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

      // 导入前纠偏
      const normalized = normalizeImportedRoots(importData.bookmarks);

      // 创建导入的书签
      await createBookmarkTree(normalized);

      // 清理临时存储
      await browser.storage.local.remove('pendingImport');

      curOperType = OperType.NONE;
      browser.action.setBadgeText({ text: "" });

      // 发送通知
      const setting = await Setting.build();
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

  // 预热 favicon，通过在后台打开标签页来触发浏览器缓存
  async function prefetchFavicons(bookmarks: BookmarkInfo[]) {
    const urls = extractUrls(bookmarks);
    const uniqueOrigins = new Set<string>();

    urls.forEach(url => {
      try {
        const urlObj = new URL(url);
        if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
          uniqueOrigins.add(urlObj.origin);
        }
      } catch (e) {
      }
    });

    const origins = Array.from(uniqueOrigins);

    const maxSites = 50;
    const sitesToLoad = origins.slice(0, maxSites);

    if (sitesToLoad.length === 0) return;

    console.log(`[BookmarkHub] Loading favicons for ${sitesToLoad.length} sites (max ${maxSites})...`);

    const waitForTabLoad = (tabId: number, timeout: number = 10000): Promise<void> => {
      return new Promise((resolve) => {
        let resolved = false;

        const listener = (updatedTabId: number, changeInfo: any) => {
          if (updatedTabId === tabId && changeInfo.status === 'complete') {
            if (!resolved) {
              resolved = true;
              browser.tabs.onUpdated.removeListener(listener);
              setTimeout(resolve, 1000);
            }
          }
        };

        browser.tabs.onUpdated.addListener(listener);

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            browser.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }, timeout);
      });
    };

    let loadedCount = 0;
    const setting = await Setting.build();
    const concurrency = setting.faviconConcurrency || 3;

    const loadSite = async (origin: string): Promise<void> => {
      try {
        const tab = await browser.tabs.create({
          url: origin,
          active: false
        });

        if (tab.id) {
          await waitForTabLoad(tab.id, 10000);
          try {
            await browser.tabs.remove(tab.id);
          } catch (e) { }
        }

        loadedCount++;
        console.log(`[BookmarkHub] Favicon ${loadedCount}/${sitesToLoad.length}: ${origin}`);
      } catch (e) {
        console.log(`[BookmarkHub] Failed to load: ${origin}`);
      }
    };

    const queue = [...sitesToLoad];
    const workers: Promise<void>[] = [];

    const worker = async () => {
      while (queue.length > 0) {
        const origin = queue.shift();
        if (origin) {
          await loadSite(origin);
        }
      }
    };

    for (let i = 0; i < Math.min(concurrency, sitesToLoad.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    console.log(`[BookmarkHub] Favicon prefetch completed: ${loadedCount} sites loaded`);

    if (setting.enableNotify) {
      await browser.notifications.create({
        type: "basic",
        iconUrl: iconLogo,
        title: "图标加载完成",
        message: `已为 ${loadedCount} 个网站加载图标`
      });
    }
  }

  function extractUrls(bookmarks: BookmarkInfo[]): string[] {
    const urls: string[] = [];

    function traverse(nodes: BookmarkInfo[]) {
      nodes.forEach(node => {
        if (node.url) {
          urls.push(node.url);
        }
        if (node.children) {
          traverse(node.children);
        }
      });
    }

    traverse(bookmarks);
    return urls;
  }
});
