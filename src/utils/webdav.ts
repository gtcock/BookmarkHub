import ky from 'ky';
import { Setting } from './setting';

class WebDAVService {
    private async getClient() {
        const setting = await Setting.build();
        const credentials = btoa(`${setting.webdavUsername}:${setting.webdavPassword}`);

        return ky.create({
            prefixUrl: setting.webdavUrl.endsWith('/') ? setting.webdavUrl : `${setting.webdavUrl}/`,
            timeout: 60000,
            retry: 1,
            hooks: {
                beforeRequest: [
                    request => {
                        request.headers.set('Authorization', `Basic ${credentials}`);
                    }
                ]
            }
        });
    }

    private getFileName(timestamp: number, baseName: string) {
        return `${baseName}_${timestamp}.json`;
    }

    private async listBackups(client: any, baseName: string) {
        // 使用 PROPFIND 获取文件列表
        const xml = await client('', {
            method: 'PROPFIND',
            headers: { 'Depth': '1' }
        }).text();

        // 简易正则解析 XML 中的 href 和 getlastmodified
        // 注意：不同服务器返回的 href 可能是绝对路径或相对路径
        const matches = [...xml.matchAll(/<d:response>[\s\S]*?<d:href>([\s\S]*?)<\/d:href>[\s\S]*?<d:getlastmodified>([\s\S]*?)<\/d:getlastmodified>[\s\S]*?<\/d:response>/g)];

        return matches
            .map(m => ({
                href: decodeURIComponent(m[1]),
                lastModified: new Date(m[2]).getTime()
            }))
            .filter(item => item.href.includes(baseName) && item.href.endsWith('.json'))
            .sort((a, b) => b.lastModified - a.lastModified); // 按时间降序
    }

    async get() {
        const setting = await Setting.build();
        const client = await this.getClient();
        try {
            const backups = await this.listBackups(client, setting.gistFileName);
            if (backups.length === 0) return null;

            // 读取最新的一个
            const latest = backups[0];
            const resp = await ky.get(latest.href, {
                headers: {
                    'Authorization': `Basic ${btoa(`${setting.webdavUsername}:${setting.webdavPassword}`)}`
                }
            }).text();
            return resp;
        } catch (error) {
            console.error('WebDAV Download Error:', error);
            return null;
        }
    }

    async update(content: string) {
        const setting = await Setting.build();
        const client = await this.getClient();
        try {
            // 1. 上传新备份
            const newFileName = this.getFileName(Date.now(), setting.gistFileName);
            await client.put(newFileName, {
                body: content,
                headers: { 'Content-Type': 'application/json;charset=utf-8' }
            });

            // 2. 清理旧备份
            const backups = await this.listBackups(client, setting.gistFileName);
            const maxBackups = setting.webdavMaxBackups || 5;
            if (backups.length > maxBackups) {
                const toDelete = backups.slice(maxBackups);
                for (const item of toDelete) {
                    try {
                        await client.delete(item.href);
                    } catch (e) {
                        console.error('WebDAV Cleanup Error:', e);
                    }
                }
            }
            return true;
        } catch (error) {
            console.error('WebDAV Upload Error:', error);
            throw error;
        }
    }

    async testConnection() {
        const client = await this.getClient();
        return client('', {
            method: 'PROPFIND',
            headers: { 'Depth': '0' }
        }).text();
    }
}

export default new WebDAVService();
