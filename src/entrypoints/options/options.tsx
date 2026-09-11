import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client';
import { Container, Form, Button, Col, Row, InputGroup, Alert } from 'react-bootstrap';
import { useForm } from "react-hook-form";
import 'bootstrap/dist/css/bootstrap.min.css';
import './options.css'
import optionsStorage from '../../utils/optionsStorage'

const Options: React.FC = () => {
    const { register } = useForm();
    const [message, setMessage] = useState<{ type: 'success' | 'danger', text: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        optionsStorage.syncForm('#formOptions');
    }, [])

    // 导出设置
    const handleExportSettings = async () => {
        try {
            const settings = await optionsStorage.getAll();
            const exportData = {
                type: 'BookmarkHub_Settings',
                version: browser.runtime.getManifest().version,
                exportDate: new Date().toISOString(),
                settings: {
                    githubToken: settings.githubToken,
                    gistID: settings.gistID,
                    gistFileName: settings.gistFileName,
                    enableNotify: settings.enableNotify,
                    syncService: settings.syncService,
                    webdavUrl: settings.webdavUrl,
                    webdavUsername: settings.webdavUsername,
                    webdavPassword: settings.webdavPassword,
                    autoSync: settings.autoSync,
                    autoSyncInterval: settings.autoSyncInterval
                }
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bookmarkhub_settings_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setMessage({ type: 'success', text: browser.i18n.getMessage('exportSettingsSuccess') });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            console.error('Export error:', e);
            setMessage({ type: 'danger', text: browser.i18n.getMessage('exportSettingsFailed') });
        }
    };

    // 触发导入文件选择
    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFetchFavicons = async () => {
      console.log('[Frontend] 点击了获取图标按钮...');
      try {
        const response = await browser.runtime.sendMessage({ action: 'FETCH_FAVICONS_NOW' });
        console.log('[Frontend] 收到后台响应:', response);
      } catch (error) {
        console.error('[Frontend] 发送消息失败:', error);
      }
    };
    // 处理导入文件
    const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const importData = JSON.parse(text);

            // 验证文件格式
            if (importData.type !== 'BookmarkHub_Settings' || !importData.settings) {
                setMessage({ type: 'danger', text: browser.i18n.getMessage('importSettingsInvalidFormat') });
                return;
            }

            const { settings } = importData;

            // 导入设置
            await optionsStorage.set({
                githubToken: settings.githubToken || '',
                gistID: settings.gistID || '',
                gistFileName: settings.gistFileName || 'BookmarkHub',
                enableNotify: settings.enableNotify !== false,
                syncService: settings.syncService || 'github',
                webdavUrl: settings.webdavUrl || '',
                webdavUsername: settings.webdavUsername || '',
                webdavPassword: settings.webdavPassword || '',
                autoSync: settings.autoSync || false,
                autoSyncInterval: settings.autoSyncInterval || 30
            });

            setMessage({ type: 'success', text: browser.i18n.getMessage('importSettingsSuccess') });

            // 刷新页面以显示新设置
            setTimeout(() => {
                window.location.reload();
            }, 1000);

        } catch (e) {
            console.error('Import error:', e);
            setMessage({ type: 'danger', text: browser.i18n.getMessage('importSettingsInvalidFormat') });
        }

        // 重置文件输入
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <Container>
            {/* 隐藏的文件输入 */}
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".json"
                onChange={handleFileImport}
            />

            {/* 消息提示 */}
            {message && (
                <Alert variant={message.type} dismissible onClose={() => setMessage(null)}>
                    {message.text}
                </Alert>
            )}

            <Form id='formOptions' name='formOptions'>
                <Form.Group as={Row}>
                    <Form.Label column="sm" sm={3} lg={2} xs={3}>GitHub Gist</Form.Label>
                    <Col sm={9} lg={10} xs={9}>
                        <Form.Check
                            id="syncGithub"
                            name="syncGithub"
                            ref={register}
                            type="switch"
                            label="Enable GitHub Sync"
                        />
                    </Col>
                </Form.Group>

                <Form.Group as={Row}>
                    <Form.Label column="sm" sm={3} lg={2} xs={3}>WebDAV</Form.Label>
                    <Col sm={9} lg={10} xs={9}>
                        <Form.Check
                            id="syncWebdav"
                            name="syncWebdav"
                            ref={register}
                            type="switch"
                            label="Enable WebDAV Sync"
                        />
                    </Col>
                </Form.Group>

                <hr />

                {/* 动态显示的配置项通常需要状态，但这里用 CSS 隐藏可能更简单，
                   不过既然 optionsStorage.syncForm 使用 name 映射，
                   我们可以根据 syncService 的值手动控制显示，
                   或者简单地全显示（但不推荐）。由于目前是 React，
                   添加一个简单的 View 状态比较好。
                */}

                <section>
                    {/* 直接列出所有字段，OptionsSync 会自动同步它们 */}
                    <div id="githubFields">
                        <Form.Group as={Row}>
                            <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('githubToken')}</Form.Label>
                            <Col sm={9} lg={10} xs={9}>
                                <InputGroup size="sm">
                                    <Form.Control name="githubToken" ref={register} type="password" placeholder="github token" size="sm" />
                                    <InputGroup.Append>
                                        <Button variant="outline-secondary" as="a" target="_blank" href="https://github.com/settings/tokens/new" size="sm">Get Token</Button>
                                    </InputGroup.Append>
                                </InputGroup>
                            </Col>
                        </Form.Group>

                        <Form.Group as={Row}>
                            <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('gistID')}</Form.Label>
                            <Col sm={9} lg={10} xs={9}>
                                <Form.Control name="gistID" ref={register} type="text" placeholder="gist ID" size="sm" />
                            </Col>
                        </Form.Group>
                    </div>

                    <div id="webdavFields">
                        <Form.Group as={Row}>
                            <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('webdavUrl')}</Form.Label>
                            <Col sm={9} lg={10} xs={9}>
                                <Form.Control name="webdavUrl" ref={register} type="text" placeholder="https://dav.jianguoyun.com/dav/" size="sm" />
                            </Col>
                        </Form.Group>
                        <Form.Group as={Row}>
                            <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('webdavUsername')}</Form.Label>
                            <Col sm={9} lg={10} xs={9}>
                                <Form.Control name="webdavUsername" ref={register} type="text" placeholder="username" size="sm" />
                            </Col>
                        </Form.Group>
                        <Form.Group as={Row}>
                            <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('webdavPassword')}</Form.Label>
                            <Col sm={9} lg={10} xs={9}>
                                <Form.Control name="webdavPassword" ref={register} type="password" placeholder="password" size="sm" />
                            </Col>
                        </Form.Group>
                    </div>
                </section>

                <Form.Group as={Row}>
                    <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('gistFileName')}</Form.Label>
                    <Col sm={9} lg={10} xs={9}>
                        <Form.Control name="gistFileName" ref={register} type="text" placeholder="data file name" size="sm" />
                    </Col>
                </Form.Group>
                <Form.Group as={Row}>
                    <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('enableNotifications')}</Form.Label>
                    <Col sm={9} lg={10} xs={9}>
                        <Form.Check
                            id="enableNotify"
                            name="enableNotify"
                            ref={register}
                            type="switch"
                        />
                    </Col>
                </Form.Group>

                {/* 自动同步设置 */}
                <hr />
                <Form.Group as={Row}>
                    <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('autoSync')}</Form.Label>
                    <Col sm={9} lg={10} xs={9}>
                        <Form.Check
                            id="autoSync"
                            name="autoSync"
                            ref={register}
                            type="switch"
                        />
                        <Form.Text className="text-muted">
                            {browser.i18n.getMessage('autoSyncDesc')}
                        </Form.Text>
                    </Col>
                </Form.Group>
                <Form.Group as={Row}>
                    <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('autoSyncInterval')}</Form.Label>
                    <Col sm={9} lg={10} xs={9}>
                        <Form.Control
                            as="select"
                            name="autoSyncInterval"
                            ref={register}
                            size="sm"
                            style={{ width: 'auto' }}
                        >
                            <option value="5">5 {browser.i18n.getMessage('minutes')}</option>
                            <option value="10">10 {browser.i18n.getMessage('minutes')}</option>
                            <option value="15">15 {browser.i18n.getMessage('minutes')}</option>
                            <option value="30">30 {browser.i18n.getMessage('minutes')}</option>
                            <option value="60">60 {browser.i18n.getMessage('minutes')}</option>
                        </Form.Control>
                    </Col>
                </Form.Group>

                {/* 设置导入导出区域 */}
                <hr />
                <Form.Group as={Row}>
                    <Form.Label column="sm" sm={3} lg={2} xs={3}>{browser.i18n.getMessage('settingsSync')}</Form.Label>
                    <Col sm={9} lg={10} xs={9}>
                        <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={handleExportSettings}
                            className="mr-2"
                        >
                            {browser.i18n.getMessage('exportSettings')}
                        </Button>
                        <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={handleImportClick}
                        >
                            {browser.i18n.getMessage('importSettings')}
                        </Button>
                        <Form.Text className="text-muted d-block mt-2">
                            {browser.i18n.getMessage('settingsSyncDesc')}
                        </Form.Text>
                    </Col>
                </Form.Group>

                <Form.Group as={Row}>
                    <Form.Label column="sm" sm={3} lg={2} xs={3}></Form.Label>
                    <Col sm={9} lg={10} xs={9}>
                        <a href="https://github.com/iwvw/BookmarkHub" target="_blank">{browser.i18n.getMessage('help')}</a>
                    </Col>
                </Form.Group>
            </Form>
        </Container >
    )
}


ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Options />
    </React.StrictMode>,
);
