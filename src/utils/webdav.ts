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
        try {
            const xml = await client('', {
                method: 'PROPFIND',
                headers: { 'Depth': '1' }
            }).text();

            // 增强版：忽略命名空间前缀 (如 d:, D:, lp1: 等)
            const resRegex = /<[^>]*?response[^>]*?>([\s\S]*?)<\/[^>]*?response[^>]*?>/gi;
            const hrefRegex = /<[^>]*?href[^>]*?>([\s\S]*?)<\/[^>]*?href[^>]*?>/i;
            const dateRegex = /<[^>]*?getlastmodified[^>]*?>([\s\S]*?)<\/[^>]*?getlastmodified[^>]*?>/i;

            const responses = [...xml.matchAll(resRegex)];
            const results: any[] = [];

            for (const res of responses) {
                const resContent = res[1];
                const hrefMatch = resContent.match(hrefRegex);
                const dateMatch = resContent.match(dateRegex);

                if (hrefMatch && dateMatch) {
                    const href = decodeURIComponent(hrefMatch[1].trim());
                    // 提取文件名用于后续请求，确保路径正确
                    const fileName = href.split('/').pop() || '';

                    if (fileName.includes(baseName) && fileName.endsWith('.json')) {
                        results.push({
                            fileName,
                            href,
                            lastModified: new Date(dateMatch[1]).getTime()
                        });
                    }
                }
            }

            return results.sort((a, b) => b.lastModified - a.lastModified); // 按时间降序
        } catch (e) {
            console.error('WebDAV listBackups Error:', e);
            return [];
        }
    }

    async get() {
        const setting = await Setting.build();
        const client = await this.getClient();
        try {
            const backups = await this.listBackups(client, setting.gistFileName);
            if (backups.length === 0) return null;

            // 读取最新版，优先使用文件名配合 client 进行请求
            const latest = backups[0];
            const resp = await client.get(latest.fileName).text();
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
                        // 使用文件名删除，确保在正确的 prefixUrl 下操作
                        await client.delete(item.fileName);
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
