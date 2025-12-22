import { Options } from 'webext-options-sync';
import optionsStorage from './optionsStorage'
export class SettingBase implements Options {
    constructor() { }
    [key: string]: string | number | boolean;
    githubToken: string = '';
    gistID: string = '';
    gistFileName: string = 'BookmarkHub';
    enableNotify: boolean = true;
    githubURL: string = 'https://api.github.com';
    autoSync: boolean = false;
    autoSyncInterval: number = 30;
    autoSyncNotify: boolean = true;
    syncGithub: boolean = true;
    syncWebdav: boolean = false;
    webdavUrl: string = '';
    webdavUsername: string = '';
    webdavPassword: string = '';
    webdavMaxBackups: number = 5;
    fetchFavicon: boolean = true;
    faviconConcurrency: number = 3;
}
export class Setting extends SettingBase {
    private constructor() { super() }
    static async build() {
        let options = await optionsStorage.getAll();
        let setting = new Setting();
        setting.gistID = options.gistID;
        setting.gistFileName = options.gistFileName;
        setting.githubToken = options.githubToken;
        setting.enableNotify = options.enableNotify;
        setting.autoSync = options.autoSync;
        setting.autoSyncInterval = options.autoSyncInterval;
        setting.autoSyncNotify = options.autoSyncNotify !== false;
        setting.syncGithub = options.syncGithub;
        setting.syncWebdav = options.syncWebdav;
        setting.webdavUrl = options.webdavUrl;
        setting.webdavUsername = options.webdavUsername;
        setting.webdavPassword = options.webdavPassword;
        setting.webdavMaxBackups = options.webdavMaxBackups || 5;
        setting.fetchFavicon = options.fetchFavicon !== false;
        setting.faviconConcurrency = options.faviconConcurrency || 3;
        return setting;
    }
}




// export class SettingBase {
//     constructor() { }
//     [key: string]: string | number | boolean;
//     githubToken: string = '';
//     gistID: string = '';
//     gistFileName: string = 'BookmarkHub';
//     enableNotify: boolean = true;
//     githubURL: string = 'https://api.github.com';
// }
// export class Setting extends SettingBase {
//     private constructor() { super() }
//     static async build() {
//         let options =new Setting();
//         let setting = new Setting();
//         setting.gistID = options.gistID;
//         setting.gistFileName = options.gistFileName;
//         setting.githubToken = options.githubToken;
//         setting.enableNotify = options.enableNotify;
//         return setting;
//     }
// }
