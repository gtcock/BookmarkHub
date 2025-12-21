import OptionsSync from 'webext-options-sync';
/* global OptionsSync */

export default new OptionsSync({
    defaults: {
        githubToken: '',
        gistID: '',
        gistFileName: 'BookmarkHub',
        enableNotify: true,
        githubURL: 'https://api.github.com',
        autoSync: false,
        autoSyncInterval: 30, // 分钟
        syncGithub: true,
        syncWebdav: false,
        webdavUrl: '',
        webdavUsername: '',
        webdavPassword: '',
        webdavMaxBackups: 5,
    },

    // List of functions that are called when the extension is updated
    migrations: [
        (savedOptions, currentDefaults) => {
            // Perhaps it was renamed
            // if (savedOptions.colour) {
            //     savedOptions.color = savedOptions.colour;
            //delete savedOptions.colour;
            // }
        },

        // Integrated utility that drops any properties that don't appear in the defaults
        OptionsSync.migrations.removeUnused
    ],
    logging: false
});