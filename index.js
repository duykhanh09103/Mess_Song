const login = require("ws3-fca");
const wait = require('node:timers/promises').setTimeout;
const childproc = require('node:child_process');
const fs = require('node:fs');
const { Builder, Browser, By, Key, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { user_data_dir, Chrome_profile_name, headless, ytdlp_binary_path, chrome_binary_path, vlc_binary_path, mmdeviceId,StartCallText,chromeDriver_binary_path } = require("./config.json");

//chrome config
let option = new chrome.Options().addArguments(`user-data-dir=${user_data_dir}`).addArguments(`profile-directory=${Chrome_profile_name}`)
if(chrome_binary_path != ""){ 
    option.setBinaryPath(chrome_binary_path);
}
if (headless) {
    option.addArguments("--headless");
}

async function writeToDb(data) {
    const { JSONFilePreset } = await import("lowdb/node");
    let dbOptions = { messsageGroup: [] };
    let db = await JSONFilePreset('GroupDB.json', dbOptions);
    try {
        await db.data.messsageGroup.push(data);
        await db.write();
    }
    catch (err) {
        console.error(err);
    }
}
async function getData() {
    const { JSONFilePreset } = await import("lowdb/node");
    let dbOptions = { messsageGroup: [] };
    let db = await JSONFilePreset('GroupDB.json', dbOptions);
    await db.read();
    return db.data.messsageGroup;

}

function isRunning(app) {
    const checkifappisrunning = childproc.execSync(`tasklist /FI "IMAGENAME eq ${app}"`).toString();
    if (checkifappisrunning.includes(app)) {
        return true;
    }
    else {
        return false
    }
}


login({ appState: JSON.parse(fs.readFileSync('fbstate.json', 'utf8')) }, async (err, api) => {
    if (err) return console.error(err);
    console.log(`Logged in as ${api.getCurrentUserID()}`);
    


    api.listenMqtt(async (err, message) => {
        if (err) return console.error(err);
        if (message && message.body && message.body.startsWith("/startcall")) {
            //build the chrome driver
            let driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(option).build();
            let data = (await getData()).find((group) => { return group.id == message.threadID });
            console.log(data);
            //check if there is data or nah
            if (data == undefined) {
                await api.sendMessage("Error! There's no call id for this group", message.threadID);
                return;
            }
            let roomId = data.roomId;
            try {
                await driver.get(`https://www.facebook.com/groupcall/ROOM:${roomId}/?has_video=false&initialize_video=false&is_e2ee_mandated=false`);
                await driver.manage().setTimeouts({ implicit: 5000 });
                await driver.findElement(By.xpath(`//*[contains(text(),'${StartCallText}')]`)).click();
            }
            catch (err) { throw err }
        }
        if (message && message.body && message.body.includes("/setcallid")) {
            let data = (await getData()).find((group) => { return group.id == message.threadID });
            let newRoomId = message.body.split(" ")[1];
            if (data == undefined) {
                await writeToDb({ id: message.threadID, roomId: newRoomId });
                await api.sendMessage("Call id set successfully", message.threadID);
                return;
            }
            else {
                await api.sendMessage(`Call id already set (${data.roomId}). Now gonna be set to ${newRoomId}`, message.threadID);
                data.roomId = newRoomId;
                await writeToDb(data);
            }
        }
        if (message && message.body && message.body.startsWith("/play")) {
            let data = (await getData()).find((group) => { return group.id == message.threadID });
            let link = message.body.toString().replace("/play", "").trim();
            //check if vlc is running before deleteing file
            if (isRunning("vlc.exe")) return console.log("VLC is already running(which mean a song is already playing)");
            //delete the file
            const DeleteOldFile = childproc.execSync(`del /f output.*`).toString();
            if (DeleteOldFile.includes("Could")) { console.log("No file to delete"); }
            //check if ytdlp running
            if (isRunning("ytdlp.exe")) return console.log("ytdlp is downloading!");
            //download the song and check for extension name
            console.log("Downloading song....");
            const ytdlpOutput = childproc.execSync(`"${ytdlp_binary_path}" -x "${link}" -o "output.%(ext)s" --no-playlist`).toString();
            if (ytdlpOutput.includes("ERROR")) return console.log("There was an error while trying to download song!");
            const match = ytdlpOutput.match(/\[ExtractAudio\] Destination: output\.(\w+)/);
            if (!match) return console.log("There was an error while trying to download song!");
            let songExtension = match[1];
            //play the song through vlc with audio pipe to VB-audio virtual cable
            console.log("Playing song....");
            childproc.spawn(vlc_binary_path, [
                '--mmdevice-audio-device', `${mmdeviceId}`,
                `output.${songExtension}`,
                '--intf', 'dummy',
                'vlc://quit'
            ], { detached: true, stdio: 'ignore' }).unref();
            api.sendMessage("Success! now playing song", message.threadID);
        }
        if (message && message.body && message.body.startsWith("/stop")) {
            //check if vlc is running
            if (!isRunning("vlc.exe")) return console.log("VLC is not running");
            //kill the vlc process
            console.log("Stopping song....");
            childproc.execSync(`taskkill /IM vlc.exe /F`);
            api.sendMessage("Success! song stopped", message.threadID);
        }
        if (message && message.body && message.body.startsWith("/quit")) {
            //check if browser is running
            if (!isRunning("chrome.exe")) return console.log("Chrome is not running");
            //kill the browser process
            console.log("Quitting browser....");
            childproc.execSync(`taskkill /IM chrome.exe /F`);
            //check if vlc is running 
            if (!isRunning("vlc.exe")) return console.log("VLC is not running");
            //kill the vlc process
            console.log("Stopping song....");
            childproc.execSync(`taskkill /IM vlc.exe /F`);
            api.sendMessage("Success! quited the call and song stopped", message.threadID);
        }
    });
});
