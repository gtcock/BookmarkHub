import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client';
import { Dropdown, Badge, Modal, Button } from 'react-bootstrap';
import { IconContext } from 'react-icons'
import {
    AiOutlineCloudUpload, AiOutlineCloudDownload,
    AiOutlineCloudSync, AiOutlineSetting, AiOutlineClear,
    AiOutlineInfoCircle, AiOutlineGithub, AiOutlineExport, AiOutlineImport,
    AiOutlineArrowLeft
} from 'react-icons/ai'
import 'bootstrap/dist/css/bootstrap.min.css';
import './popup.css'
import iconLogo from '../../assets/icon.png'
import optionsStorage from '../../utils/optionsStorage';

interface ConfirmAction {
    name: string;
    title: string;
    message: string;
}

const Popup: React.FC = () => {
    const [count, setCount] = useState({ local: "0", remote: "0" })
    const [showConfirm, setShowConfirm] = useState(false)
    const [pendingAction, setPendingAction] = useState<ConfirmAction | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [view, setView] = useState<'menu' | 'settings'>('menu')
    const [settings, setSettings] = useState<any>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // 需要确认的操作
    const confirmActions: Record<string, ConfirmAction> = {
        upload: {
            name: 'upload',
            title: browser.i18n.getMessage('uploadBookmarks'),
            message: browser.i18n.getMessage('uploadBookmarksDesc')
        },
        download: {
            name: 'download',
            title: browser.i18n.getMessage('downloadBookmarks'),
            message: browser.i18n.getMessage('downloadBookmarksDesc')
        },
        removeAll: {
            name: 'removeAll',
            title: browser.i18n.getMessage('removeAllBookmarks'),
            message: browser.i18n.getMessage('removeAllBookmarksDesc')
        },
        importBookmarks: {
            name: 'importBookmarks',
            title: browser.i18n.getMessage('importBookmarks'),
            message: browser.i18n.getMessage('importBookmarksDesc')
        },
        sync: {
            name: 'sync',
            title: browser.i18n.getMessage('syncBookmarks'),
            message: browser.i18n.getMessage('syncBookmarksDesc')
        }
    }

    useEffect(() => {
        const loadSettings = async () => {
            const currentSettings = await optionsStorage.getAll();
            setSettings(currentSettings);
        };
        loadSettings();
    }, []);

    const handleAction = (actionName: string) => {
        if (actionName === 'exportBookmarks') {
            exportBookmarks()
        } else if (actionName === 'triggerImport') {
            fileInputRef.current?.click()
        } else if (actionName === 'setting') {
            setView('settings')
        } else if (confirmActions[actionName]) {
            setPendingAction(confirmActions[actionName])
            setShowConfirm(true)
        } else {
            executeAction(actionName)
        }
    }

    const handleSettingChange = async (key: string, value: any) => {
        setSettings({ ...settings, [key]: value });
        await optionsStorage.set({ [key]: value });
    };

    const handleTest = async (type: 'github' | 'webdav') => {
        setIsLoading(true);
        try {
            const msgName = type === 'github' ? 'testGithub' : 'testWebdav';
            const response = await browser.runtime.sendMessage({ name: msgName });
            if (response.success) {
                // 显示成功通知
                const successMsg = type === 'github' ? browser.i18n.getMessage('testGithubSuccess') : browser.i18n.getMessage('testWebdavSuccess');
                await browser.notifications.create({
                    type: "basic",
                    iconUrl: iconLogo,
                    title: browser.i18n.getMessage('testConnection'),
                    message: successMsg
                });
            } else {
                alert(`${browser.i18n.getMessage('testFailed')}: ${response.message}`);
            }
        } catch (e: any) {
            alert(`${browser.i18n.getMessage('testFailed')}: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const renderFormattedMessage = (msg: string) => {
        const parts = msg.split('(');
        if (parts.length > 1) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ lineHeight: 1.1 }}>{parts[0].trim()}</span>
                    <span className="msg-sub">({parts[1]}</span>
                </div>
            );
        }
        return msg;
    };

    const executeAction = async (actionName: string) => {
        setIsLoading(true)
        try {
            await browser.runtime.sendMessage({ name: actionName })
            // 刷新计数
            const data = await browser.storage.local.get(["localCount", "remoteCount"]);
            setCount({ local: data["localCount"], remote: data["remoteCount"] });
        } catch (e) {
            console.log("error", e)
        } finally {
            setIsLoading(false)
            setShowConfirm(false)
            setPendingAction(null)
        }
    }

    // 导出书签到本地文件
    const exportBookmarks = async () => {
        setIsLoading(true)
        try {
            const response = await browser.runtime.sendMessage({ name: 'getBookmarksForExport' })
            if (response && response.bookmarks) {
                const exportData = {
                    version: response.version,
                    exportDate: new Date().toISOString(),
                    browser: navigator.userAgent,
                    bookmarks: response.bookmarks
                }
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `bookmarks_${new Date().toISOString().slice(0, 10)}.json`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
            }
        } catch (e) {
            console.log("export error", e)
        } finally {
            setIsLoading(false)
        }
    }

    // 处理导入文件
    const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        try {
            const text = await file.text()
            const importData = JSON.parse(text)

            if (!importData.bookmarks || !Array.isArray(importData.bookmarks)) {
                alert(browser.i18n.getMessage('importInvalidFormat'))
                return
            }

            // 保存导入数据到临时存储，然后显示确认对话框
            await browser.storage.local.set({ pendingImport: importData })
            setPendingAction(confirmActions['importBookmarks'])
            setShowConfirm(true)
        } catch (e) {
            console.log("import error", e)
            alert(browser.i18n.getMessage('importInvalidFormat'))
        }

        // 重置文件输入
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    const handleConfirm = async () => {
        if (pendingAction) {
            if (pendingAction.name === 'importBookmarks') {
                // 执行导入
                setIsLoading(true)
                try {
                    await browser.runtime.sendMessage({ name: 'importBookmarks' })
                    // 刷新计数
                    const data = await browser.storage.local.get(["localCount", "remoteCount"]);
                    setCount({ local: data["localCount"], remote: data["remoteCount"] });
                } catch (e) {
                    console.log("import error", e)
                } finally {
                    setIsLoading(false)
                    setShowConfirm(false)
                    setPendingAction(null)
                }
            } else {
                executeAction(pendingAction.name)
            }
        }
    }

    const handleCancel = async () => {
        // 清理临时存储
        await browser.storage.local.remove('pendingImport')
        setShowConfirm(false)
        setPendingAction(null)
    }

    useEffect(() => {
        let getSetting = async () => {
            let data = await browser.storage.local.get(["localCount", "remoteCount"]);
            setCount({ local: data["localCount"], remote: data["remoteCount"] });
        }
        getSetting();
    }, [])

    return (
        <IconContext.Provider value={{ className: 'dropdown-item-icon' }}>
            <div className="popup-container">
                {view === 'menu' ? (
                    <div className="menu-view">
                        <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: 'none' }}
                            accept=".json"
                            onChange={handleFileImport}
                        />

                        <div className="menu-list">
                            <button
                                className="menu-item sync-btn"
                                onClick={() => handleAction('sync')}
                                disabled={isLoading}
                                title={browser.i18n.getMessage('syncBookmarksDesc')}
                            >
                                <AiOutlineCloudSync className="menu-item-icon" />
                                <span>{renderFormattedMessage(browser.i18n.getMessage('syncBookmarks'))}</span>
                            </button>

                            <div className="menu-divider" />

                            <div className="menu-row">
                                <button className="menu-item" onClick={() => handleAction('upload')} disabled={isLoading}>
                                    <AiOutlineCloudUpload className="menu-item-icon" />
                                    <span>{renderFormattedMessage(browser.i18n.getMessage('uploadBookmarks'))}</span>
                                </button>
                                <button className="menu-item" onClick={() => handleAction('download')} disabled={isLoading}>
                                    <AiOutlineCloudDownload className="menu-item-icon" />
                                    <span>{renderFormattedMessage(browser.i18n.getMessage('downloadBookmarks'))}</span>
                                </button>
                            </div>

                            <button className="menu-item" onClick={() => handleAction('removeAll')} disabled={isLoading}>
                                <AiOutlineClear className="menu-item-icon" />
                                <span>{browser.i18n.getMessage('removeAllBookmarks')}</span>
                            </button>

                            <div className="menu-divider" />

                            <div className="menu-row">
                                <button className="menu-item" onClick={() => handleAction('exportBookmarks')} disabled={isLoading}>
                                    <AiOutlineExport className="menu-item-icon" />
                                    <span>{browser.i18n.getMessage('exportBookmarks')}</span>
                                </button>
                                <button className="menu-item" onClick={() => handleAction('triggerImport')} disabled={isLoading}>
                                    <AiOutlineImport className="menu-item-icon" />
                                    <span>{browser.i18n.getMessage('importBookmarks')}</span>
                                </button>
                            </div>

                            <div className="menu-divider" />

                            <button className="menu-item" onClick={() => handleAction('setting')}>
                                <AiOutlineSetting className="menu-item-icon" />
                                <span>{browser.i18n.getMessage('settings')}</span>
                            </button>

                            <div className="menu-footer">
                                <a href="https://github.com/dudor/BookmarkHub" target="_blank" className="footer-icon-link" title={browser.i18n.getMessage('help')}>
                                    <AiOutlineInfoCircle />
                                </a>
                                <div className="footer-stats-grid">
                                    <div className="stat-cell">
                                        <span className="stat-label">本地</span>
                                        <span className="stat-value">{count["local"]}</span>
                                    </div>
                                    <div className="stat-cell">
                                        <span className="stat-label">云端</span>
                                        <span className="stat-value">{count["remote"]}</span>
                                    </div>
                                </div>
                                <a href="https://github.com/dudor" target="_blank" className="github-link"><AiOutlineGithub /></a>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="settings-view">
                        <div className="settings-header">
                            <button className="back-btn" onClick={() => setView('menu')} title={browser.i18n.getMessage('back')}>
                                <AiOutlineArrowLeft />
                            </button>
                            <span className="header-title">{browser.i18n.getMessage('settings')}</span>
                        </div>
                        <div className="settings-list">
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="setting-title">GitHub Gist</span>
                                </div>
                                <div className="setting-control">
                                    <input
                                        type="checkbox"
                                        className="setting-checkbox"
                                        checked={settings?.syncGithub || false}
                                        onChange={(e) => handleSettingChange('syncGithub', e.target.checked)}
                                    />
                                </div>
                            </div>
                            {settings?.syncGithub && (
                                <div>
                                    <div className="setting-group">
                                        <div className="setting-label-row">
                                            <label className="setting-label">GitHub Token</label>
                                            <button className="text-btn" onClick={() => handleTest('github')}>{browser.i18n.getMessage('testConnection')}</button>
                                        </div>
                                        <input
                                            type="password"
                                            className="setting-input"
                                            value={settings?.githubToken || ''}
                                            onChange={(e) => handleSettingChange('githubToken', e.target.value)}
                                            placeholder="ghp_xxxxxxxxxxxx"
                                        />
                                    </div>
                                    <div className="setting-group">
                                        <label className="setting-label">Gist ID</label>
                                        <input
                                            type="text"
                                            className="setting-input"
                                            value={settings?.gistID || ''}
                                            onChange={(e) => handleSettingChange('gistID', e.target.value)}
                                            placeholder="Gist ID"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="setting-divider" />

                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="setting-title">WebDAV</span>
                                </div>
                                <div className="setting-control">
                                    <input
                                        type="checkbox"
                                        className="setting-checkbox"
                                        checked={settings?.syncWebdav || false}
                                        onChange={(e) => handleSettingChange('syncWebdav', e.target.checked)}
                                    />
                                </div>
                            </div>
                            {settings?.syncWebdav && (
                                <div>
                                    <div className="setting-group">
                                        <div className="setting-label-row">
                                            <label className="setting-label">{browser.i18n.getMessage('webdavUrl')}</label>
                                            <button className="text-btn" onClick={() => handleTest('webdav')}>{browser.i18n.getMessage('testConnection')}</button>
                                        </div>
                                        <input
                                            type="text"
                                            className="setting-input"
                                            value={settings?.webdavUrl || ''}
                                            onChange={(e) => handleSettingChange('webdavUrl', e.target.value)}
                                            placeholder="https://dav.jianguoyun.com/dav/"
                                        />
                                    </div>
                                    <div className="setting-group">
                                        <label className="setting-label">{browser.i18n.getMessage('webdavUsername')}</label>
                                        <input
                                            type="text"
                                            className="setting-input"
                                            value={settings?.webdavUsername || ''}
                                            onChange={(e) => handleSettingChange('webdavUsername', e.target.value)}
                                            placeholder="Username"
                                        />
                                    </div>
                                    <div className="setting-group">
                                        <label className="setting-label">{browser.i18n.getMessage('webdavPassword')}</label>
                                        <input
                                            type="password"
                                            className="setting-input"
                                            value={settings?.webdavPassword || ''}
                                            onChange={(e) => handleSettingChange('webdavPassword', e.target.value)}
                                            placeholder="Password"
                                        />
                                    </div>
                                    <div className="setting-group">
                                        <label className="setting-label">{browser.i18n.getMessage('webdavMaxBackups')}</label>
                                        <input
                                            type="number"
                                            className="setting-input"
                                            min="1"
                                            max="100"
                                            value={settings?.webdavMaxBackups || 5}
                                            onChange={(e) => handleSettingChange('webdavMaxBackups', Number(e.target.value))}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="setting-divider" />

                            <div className="setting-group">
                                <label className="setting-label">{browser.i18n.getMessage('gistFileName')}</label>
                                <input
                                    type="text"
                                    className="setting-input"
                                    value={settings?.gistFileName || ''}
                                    onChange={(e) => handleSettingChange('gistFileName', e.target.value)}
                                />
                            </div>
                            <div className="setting-divider" />
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="setting-title">{browser.i18n.getMessage('autoSync')}</span>
                                </div>
                                <div className="setting-control">
                                    <input
                                        type="checkbox"
                                        className="setting-checkbox"
                                        checked={settings?.autoSync || false}
                                        onChange={(e) => handleSettingChange('autoSync', e.target.checked)}
                                    />
                                </div>
                            </div>
                            {settings?.autoSync && (
                                <div className="setting-group">
                                    <label className="setting-label">{browser.i18n.getMessage('autoSyncInterval')}</label>
                                    <select
                                        className="setting-select"
                                        value={settings?.autoSyncInterval || 30}
                                        onChange={(e) => handleSettingChange('autoSyncInterval', Number(e.target.value))}
                                    >
                                        <option value="5">5 {browser.i18n.getMessage('minutes')}</option>
                                        <option value="10">10 {browser.i18n.getMessage('minutes')}</option>
                                        <option value="15">15 {browser.i18n.getMessage('minutes')}</option>
                                        <option value="30">30 {browser.i18n.getMessage('minutes')}</option>
                                        <option value="60">60 {browser.i18n.getMessage('minutes')}</option>
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <Modal show={showConfirm} onHide={handleCancel} centered size="sm">
                <Modal.Header>
                    <Modal.Title>{pendingAction?.title}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p>{pendingAction?.message}</p>
                    <p><strong>{browser.i18n.getMessage('confirmAction')}</strong></p>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={handleCancel} disabled={isLoading}>
                        {browser.i18n.getMessage('cancel')}
                    </Button>
                    <Button variant="primary" onClick={handleConfirm} disabled={isLoading}>
                        {isLoading ? browser.i18n.getMessage('processing') : browser.i18n.getMessage('confirm')}
                    </Button>
                </Modal.Footer>
            </Modal>
        </IconContext.Provider>
    )
}


ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Popup />
    </React.StrictMode>,
);
