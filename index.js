const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Detect Railway environment
const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production' || 
                 process.env.RAILWAY_PROJECT_ID || 
                 process.env.RAILWAY_STATIC_URL;

class WhatsAppBot {
    constructor(botId, botName) {
        this.botId = botId;
        this.botName = botName;
        this.client = null;
        this.isReady = false;
        this.isAuthenticated = false;
        this.pendingMessages = new Map();
        this.groups = new Map();
        
        this.initializeClient();
    }

    initializeClient() {
        // Ensure auth folder exists
        const authPath = path.join(__dirname, '.wwebjs_auth');
        if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
            console.log('📁 Created .wwebjs_auth folder');
        }

        // Railway-optimized Puppeteer config
        const puppeteerConfig = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ]
};


        this.client = new Client({
            authStrategy: new LocalAuth({
                clientId: `bot-${this.botId}`,
                dataPath: './.wwebjs_auth'
            }),
            puppeteer: puppeteerConfig,
            qrMaxRetries: isRailway ? 1 : 5
        });

        this.setupEventListeners();
    }

    setupEventListeners() {
        // QR Code event - Railway optimized
        this.client.on('qr', (qr) => {
            if (isRailway) {
                console.log('\n🚂 RAILWAY QR CODE - SCAN IMMEDIATELY!');
                console.log('═══════════════════════════════════════');
                console.log(`Bot: ${this.botName}`);
                console.log('═══════════════════════════════════════');
                console.log('\n📱 QR STRING (copy to QR generator):');
                console.log(qr);
                console.log('\n🔗 Or use online QR generator:');
                console.log('https://qr-code-generator.com/');
                console.log('\n⚠️  IMPORTANT: Scan dalam 3 menit atau deployment restart!');
                console.log('⏳ Menunggu scan...\n');
                
                // Railway timeout warning
                setTimeout(() => {
                    if (!this.isAuthenticated) {
                        console.log('⚠️  WARNING: 2 menit tersisa untuk scan QR!');
                    }
                }, 60000);
                
                setTimeout(() => {
                    if (!this.isAuthenticated) {
                        console.log('🚨 CRITICAL: 1 menit tersisa! Scan sekarang atau bot restart!');
                    }
                }, 120000);
                
            } else {
                console.log(`\n╔══════════════════════════════════════╗`);
                console.log(`║     BOT: ${this.botName.padEnd(23)} ║`);
                console.log(`╚══════════════════════════════════════╝`);
                console.log('📱 Scan QR code untuk login:');
                qrcode.generate(qr, { small: true });
                console.log('⏳ Menunggu scan...\n');
            }
        });

        // Loading screen
        this.client.on('loading_screen', (percent, message) => {
            if (isRailway) {
                console.log(`🚂 Railway loading: ${percent}% - ${message}`);
            } else {
                console.log(`🔄 Loading: ${percent}% - ${message}`);
            }
        });

        // Ready event
        this.client.on('ready', async () => {
            this.isReady = true;
            this.isAuthenticated = true;
            
            const environment = isRailway ? 'Railway 🚂' : 'Local 💻';
            console.log(`\n✅ BOT READY: ${this.botName}`);
            console.log(`🌐 Environment: ${environment}`);
            console.log(`📱 Number: ${this.client.info.wid.user}`);
            console.log(`📋 Platform: ${this.client.info.platform}`);
            
            if (isRailway) {
                console.log(`💾 Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
                console.log(`⏰ Uptime: ${Math.floor(process.uptime())}s`);
            }
            
            // Check status capability
            try {
                const chats = await this.client.getChats();
                const hasStatusChat = chats.some(chat => chat.id._serialized === 'status@broadcast');
                console.log(`📊 Status Chat: ${hasStatusChat ? '✅' : '❌'}`);
                
                if (isRailway && hasStatusChat) {
                    console.log('🎉 Railway bot ready with status support!');
                }
            } catch (err) {
                console.log(`⚠️ Could not check status: ${err.message}`);
            }
            
            await this.loadGroups();
        });

        // Message handler
        this.client.on('message', async (message) => {
            await this.handleMessage(message);
        });

        // Group join
        this.client.on('group_join', async (notification) => {
            const chat = await notification.getChat();
            if (chat.name === 'TERNAK BABI') {
                await chat.sendMessage('saya sudah di acc');
                console.log(`✅ Joined group: ${chat.name}`);
            }
        });

        // Auth success
        this.client.on('authenticated', () => {
            this.isAuthenticated = true;
            if (isRailway) {
                console.log(`🔐 Railway: Authenticated from saved session!`);
                console.log(`📁 Session loaded successfully`);
            } else {
                console.log(`✅ Authenticated automatically!`);
            }
        });

        // Auth failure
        this.client.on('auth_failure', (msg) => {
            this.isAuthenticated = false;
            console.log(`❌ Auth failed: ${msg}`);
            
            if (isRailway) {
                console.log(`🚂 Railway: Session expired, need new QR scan`);
                console.log(`🔄 Update your GitHub repo with fresh session after local scan`);
            }
        });

        // Disconnect
        this.client.on('disconnected', (reason) => {
            console.log(`⚠️ Bot disconnected: ${reason}`);
            this.isReady = false;
            
            if (isRailway) {
                console.log(`🚂 Railway: Will attempt auto-restart...`);
            }
        });
    }

    async handleMessage(message) {
        try {
            const contact = await message.getContact();
            const chat = await message.getChat();
            const isPrivate = !chat.isGroup;

            // .kirim_ke_grup command
            if (message.body.toLowerCase().startsWith('.kirim_ke_grup') && isPrivate && message.hasMedia) {
                await this.handleSendToGroupCommand(message);
                return;
            }

            // Group invitation
            if (message.body.includes('chat.whatsapp.com') && isPrivate) {
                await this.handleGroupInvitation(message);
                return;
            }

            // .absen command
            if (message.body.toLowerCase() === '.absen') {
                await message.reply('ngok');
                console.log(`📝 Replied .absen with "ngok"`);
                return;
            }

            // .kirim_pesan command
            if (message.body.toLowerCase() === '.kirim_pesan' && isPrivate) {
                await this.handleSendMessageCommand(message);
                return;
            }

            // .cek_status command
            if (message.body.toLowerCase() === '.cek_status' && isPrivate) {
                await this.handleCheckStatusCommand(message);
                return;
            }

            // .bikin_sw command
            if (message.body.toLowerCase() === '.bikin_sw' && message.hasMedia && isPrivate) {
                await this.handleStatusCommand(message);
                return;
            }

            // .forward_status command
            if (message.body.toLowerCase() === '.forward_status' && isPrivate) {
                if (message.hasQuotedMsg) {
                    const quotedMsg = await message.getQuotedMessage();
                    
                    try {
                        const result = await quotedMsg.forward('status@broadcast');
                        
                        if (result) {
                            await message.reply('✅ Pesan berhasil diforward ke status!\n\n📱 Cek di HP (bukan WhatsApp Web)');
                            console.log(`✅ Message forwarded to status`);
                        } else {
                            await message.reply('❌ Gagal forward ke status');
                        }
                    } catch (error) {
                        await message.reply(`❌ Error: ${error.message}`);
                    }
                } else {
                    await message.reply('❌ Reply pesan yang mau diforward, lalu ketik .forward_status');
                }
                return;
            }

            // .help command
            if (message.body.toLowerCase() === '.help' && isPrivate) {
                await this.handleHelpCommand(message);
                return;
            }

            // .ping command
            if (message.body.toLowerCase() === '.ping' && isPrivate) {
                const uptime = Math.floor(process.uptime());
                const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                const environment = isRailway ? 'Railway 🚂' : 'Local 💻';
                
                await message.reply(`🏓 Pong!\n\n🤖 Bot: ${this.botName}\n🌐 Environment: ${environment}\n⏰ Uptime: ${uptime}s\n💾 Memory: ${memory}MB`);
                return;
            }

            // .railway command - Railway specific info
            if (message.body.toLowerCase() === '.railway' && isPrivate && isRailway) {
                const railwayInfo = `🚂 *Railway Bot Info*\n\n` +
                    `📊 Environment Variables:\n` +
                    `• RAILWAY_PROJECT_ID: ${process.env.RAILWAY_PROJECT_ID ? '✅' : '❌'}\n` +
                    `• RAILWAY_ENVIRONMENT: ${process.env.RAILWAY_ENVIRONMENT || 'undefined'}\n` +
                    `• RAILWAY_STATIC_URL: ${process.env.RAILWAY_STATIC_URL ? '✅' : '❌'}\n\n` +
                    `⚡ Performance:\n` +
                    `• Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n` +
                    `• Uptime: ${Math.floor(process.uptime())}s\n` +
                    `• Node Version: ${process.version}\n\n` +
                    `🔄 Auto-restart: Active\n` +
                    `📁 Session: Persistent via GitHub`;
                
                await message.reply(railwayInfo);
                return;
            }

            // Handle pending messages
            if (this.pendingMessages.has(contact.id._serialized)) {
                await this.handlePendingMessage(message, contact);
                return;
            }

        } catch (error) {
            console.error(`❌ Error handling message:`, error.message);
            
            if (isRailway) {
                console.error(`🚂 Railway error details:`, error.stack);
            }
        }
    }

    // Status command with Railway optimization
    async handleStatusCommand(message) {
        try {
            if (!message.hasMedia) {
                await message.reply('❌ Kirim gambar/video dengan caption .bikin_sw');
                return;
            }

            if (!this.isReady) {
                await message.reply('⚠️ Bot belum siap, tunggu sebentar...');
                return;
            }

            await message.reply(`🔄 Memproses media untuk status...\n${isRailway ? '🚂 Processing on Railway' : '💻 Processing locally'}`);

            try {
                // Try forward first
                const result = await message.forward('status@broadcast');
                
                if (result) {
                    const successMsg = `✅ *Media berhasil ke status!*\n\n📱 *CEK DI HP ANDA!*\n(Status tidak muncul di WhatsApp Web)\n\n⏰ Status muncul dalam 1-3 menit`;
                    
                    await message.reply(successMsg);
                    console.log(`✅ Media forwarded to status`);
                    return;
                }
                
                throw new Error('Forward result empty');
                
            } catch (forwardError) {
                console.log(`❌ Forward failed: ${forwardError.message}`);
                console.log(`🔄 Trying fallback method...`);
                
                // Fallback: download and send
                const media = await message.downloadMedia();
                
                if (!media?.data) {
                    throw new Error('Media invalid atau rusak');
                }

                const mediaSize = Buffer.from(media.data, 'base64').length;
                const maxSize = 15 * 1024 * 1024; // 15MB
                
                if (mediaSize > maxSize) {
                    await message.reply(`❌ Media terlalu besar (${(mediaSize/1024/1024).toFixed(2)}MB). Max 15MB.`);
                    return;
                }

                const sendResult = await this.client.sendMessage('status@broadcast', media);
                
                if (sendResult) {
                    const successMsg = `✅ *Media berhasil ke status!*\n\n📱 *CEK DI HP!* (bukan Web)\n⏰ Muncul dalam 1-5 menit`;
                    await message.reply(successMsg);
                    console.log(`✅ Media sent to status (fallback)`);
                } else {
                    throw new Error('Semua method gagal');
                }
            }
            
        } catch (error) {
            console.error(`💥 Status command error:`, error);
            await message.reply(`❌ Error: ${error.message}\n\n🔄 Coba lagi atau hubungi admin`);
        }
    }

    // Help command with Railway info
    async handleHelpCommand(message) {
        const environment = isRailway ? 'Railway 🚂' : 'Local 💻';
        const railwayCommands = isRailway ? `\n🏓 *.ping* - Test bot response\n🚂 *.railway* - Railway info\n` : '\n🏓 *.ping* - Test bot response\n';
        
        const helpText = `🤖 *BOT COMMANDS*\n\n` +
            `📝 *.absen* - Reply "ngok"\n\n` +
            `📤 *.kirim_pesan* - Kirim pesan ke grup\n\n` +
            `📂 *.kirim_ke_grup [nama]* - Kirim media ke grup\n\n` +
            `📊 *.bikin_sw* - Forward media ke status\n\n` +
            `🔄 *.forward_status* - Forward pesan ke status\n\n` +
            `🔍 *.cek_status* - Info status bot${railwayCommands}\n` +
            `🌐 **Environment:** ${environment}\n\n` +
            `💡 **Tips:**\n` +
            `• Status hanya muncul di HP\n` +
            `• Tidak muncul di WhatsApp Web\n` +
            `• Format: JPG, PNG, MP4 (max 15MB)`;
        
        await message.reply(helpText);
    }

    // Other methods remain similar but with Railway optimizations...
    async handleSendToGroupCommand(message) {
        try {
            await this.loadGroups();
            
            if (this.groups.size === 0) {
                await message.reply('❌ Bot belum join grup manapun.');
                return;
            }

            const commandParts = message.body.split(' ');
            let targetGroupName = commandParts.length > 1 ? commandParts.slice(1).join(' ').toLowerCase() : null;
            let targetGroupId = null;
            
            if (targetGroupName) {
                for (const [groupId, groupName] of this.groups) {
                    if (groupName.toLowerCase().includes(targetGroupName)) {
                        targetGroupId = groupId;
                        break;
                    }
                }
            }

            if (!targetGroupId) {
                let groupList = '📋 *Pilih grup untuk kirim media:*\n\n';
                let index = 1;
                
                for (const [groupId, groupName] of this.groups) {
                    groupList += `${index}. ${groupName}\n`;
                    index++;
                }
                
                groupList += '\n💡 Gunakan: .kirim_ke_grup [nama grup]';
                await message.reply(groupList);
                return;
            }

            const media = await message.downloadMedia();
            
            if (media) {
                await this.client.sendMessage(targetGroupId, media);
                const groupName = this.groups.get(targetGroupId);
                await message.reply(`✅ Media berhasil dikirim ke *${groupName}*!`);
                console.log(`📤 Media sent to group: ${groupName}`);
            } else {
                await message.reply('❌ Gagal download media.');
            }

        } catch (error) {
            await message.reply('❌ Gagal kirim media ke grup.');
            console.error(`❌ Send to group error:`, error.message);
        }
    }

    async handleGroupInvitation(message) {
        try {
            const inviteCode = message.body.split('chat.whatsapp.com/')[1];
            if (inviteCode) {
                await this.client.acceptInvite(inviteCode);
                await message.reply('✅ Berhasil join grup! Menunggu approval admin...');
                console.log(`📥 Trying to join group`);
            }
        } catch (error) {
            await message.reply('❌ Gagal join grup. Link invalid atau expired.');
            console.error(`❌ Group join error:`, error.message);
        }
    }

    async handleSendMessageCommand(message) {
        await this.loadGroups();
        
        if (this.groups.size === 0) {
            await message.reply('❌ Bot belum join grup manapun.');
            return;
        }

        let groupList = '📋 *Pilih grup untuk kirim pesan:*\n\n';
        let index = 1;
        
        for (const [groupId, groupName] of this.groups) {
            groupList += `${index}. ${groupName}\n`;
            index++;
        }
        
        groupList += '\n💬 Ketik nomor grup:';
        await message.reply(groupList);
        
        this.pendingMessages.set(message.from, {
            step: 'select_group',
            groups: Array.from(this.groups),
            originalMessage: message
        });
    }

    async handleCheckStatusCommand(message) {
        try {
            const chats = await this.client.getChats();
            const statusChat = chats.find(chat => chat.id._serialized === 'status@broadcast');
            const environment = isRailway ? 'Railway 🚂' : 'Local 💻';
            const uptime = Math.floor(process.uptime());
            const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            
            let statusInfo = '📊 *Bot Status Info:*\n\n';
            statusInfo += `🤖 Bot: ${this.botName}\n`;
            statusInfo += `📱 Number: ${this.client.info.wid.user}\n`;
            statusInfo += `🌐 Environment: ${environment}\n`;
            statusInfo += `⏰ Uptime: ${uptime}s\n`;
            statusInfo += `💾 Memory: ${memory}MB\n`;
            statusInfo += `🔗 Status Chat: ${statusChat ? '✅' : '❌'}\n\n`;
            
            if (isRailway) {
                statusInfo += `🚂 *Railway Info:*\n`;
                statusInfo += `• Project ID: ${process.env.RAILWAY_PROJECT_ID ? '✅' : '❌'}\n`;
                statusInfo += `• Auto-restart: ✅\n`;
                statusInfo += `• Session persist: ✅\n\n`;
            }
            
            statusInfo += `💡 *Tips:*\n• Status hanya muncul di HP\n• Gunakan .ping untuk test`;

            await message.reply(statusInfo);
            
        } catch (error) {
            await message.reply('❌ Gagal cek status bot.');
            console.error(`❌ Check status error:`, error.message);
        }
    }

    async handlePendingMessage(message, contact) {
        const pending = this.pendingMessages.get(contact.id._serialized);
        
        if (pending.step === 'select_group') {
            const selection = parseInt(message.body.trim());
            
            if (message.body.toLowerCase() === 'batal') {
                this.pendingMessages.delete(contact.id._serialized);
                await message.reply('❌ Dibatalkan.');
                return;
            }
            
            if (isNaN(selection) || selection < 1 || selection > pending.groups.length) {
                await message.reply('❌ Pilihan invalid. Ketik nomor atau "batal".');
                return;
            }
            
            const selectedGroup = pending.groups[selection - 1];
            pending.selectedGroup = selectedGroup;
            pending.step = 'input_message';
            
            await message.reply(`✅ Grup: *${selectedGroup[1]}*\n\n💬 Ketik pesan atau "batal":`);
            
        } else if (pending.step === 'input_message') {
            if (message.body.toLowerCase() === 'batal') {
                this.pendingMessages.delete(contact.id._serialized);
                await message.reply('❌ Dibatalkan.');
                return;
            }
            
            try {
                const groupId = pending.selectedGroup[0];
                await this.client.sendMessage(groupId, message.body);
                await message.reply(`✅ Pesan dikirim ke *${pending.selectedGroup[1]}*!`);
                console.log(`📤 Message sent to group: ${pending.selectedGroup[1]}`);
            } catch (error) {
                await message.reply('❌ Gagal kirim pesan.');
                console.error(`❌ Send message error:`, error.message);
            }
            
            this.pendingMessages.delete(contact.id._serialized);
        }
    }

    async loadGroups() {
        try {
            const chats = await this.client.getChats();
            this.groups.clear();
            
            chats.forEach(chat => {
                if (chat.isGroup) {
                    this.groups.set(chat.id._serialized, chat.name);
                }
            });
            
        } catch (error) {
            console.error(`❌ Load groups error:`, error.message);
        }
    }

    async start() {
        const environment = isRailway ? 'Railway' : 'locally';
        console.log(`🚀 Starting bot "${this.botName}" ${environment}...`);
        
        try {
            await this.client.initialize();
        } catch (error) {
            console.error(`❌ Bot start error:`, error.message);
            
            if (isRailway) {
                console.error(`🚂 Railway startup failed:`, error.stack);
                
                // Railway restart strategy
                setTimeout(() => {
                    console.log('🔄 Attempting Railway restart...');
                    process.exit(1); // Railway will restart
                }, 10000);
            }
        }
    }

    async stop() {
        if (this.client) {
            await this.client.destroy();
            console.log(`🛑 Bot "${this.botName}" stopped`);
        }
    }
}

class BotManager {
    constructor() {
        this.bots = new Map();
        this.botNames = new Set();
        this.botConfigFile = './bot_config.json';
        this.isLoading = false;
        
        if (isRailway) {
            console.log('\n🚂 RAILWAY DEPLOYMENT DETECTED');
            console.log('================================');
            console.log('🔄 Auto-starting bots...');
            this.startRailwayBots();
        } else {
            this.rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            this.loadBotConfig();
        }
    }

    // Railway auto-start with better error handling
    startRailwayBots() {
        try {
            if (fs.existsSync(this.botConfigFile)) {
                const config = JSON.parse(fs.readFileSync(this.botConfigFile, 'utf8'));
                
                if (config.bots && config.bots.length > 0) {
                    console.log(`🤖 Loading ${config.bots.length} saved bot(s)...`);
                    
                    // Remove duplicates
                    const uniqueBots = this.removeDuplicateBots(config.bots);
                    
                    uniqueBots.forEach(botInfo => {
                        const bot = new WhatsAppBot(botInfo.id, botInfo.name);
                        this.bots.set(botInfo.id, bot);
                        this.botNames.add(botInfo.name.toLowerCase());
                        
                        bot.start();
                        console.log(`🚀 Started: ${botInfo.name} (ID: ${botInfo.id})`);
                    });
                    
                    this.setupRailwayMonitoring();
                    
                } else {
                    console.log('⚠️ No saved bots - creating default...');
                    this.createDefaultRailwayBot();
                }
            } else {
                console.log('⚠️ No config found - creating default...');
                this.createDefaultRailwayBot();
            }
        } catch (error) {
            console.error('❌ Railway start error:', error.message);
            console.log('🔄 Creating emergency bot...');
            this.createDefaultRailwayBot();
        }
    }

    createDefaultRailwayBot() {
        const botId = Date.now();
        const botName = `Railway-Bot-${new Date().toISOString().slice(0,10)}`;
        
        const bot = new WhatsAppBot(botId, botName);
        this.bots.set(botId, bot);
        this.botNames.add(botName.toLowerCase());
        
        bot.start();
        console.log(`🚀 Default Railway bot created: ${botName}`);
        
        // Save config
        this.saveDefaultConfig(botId, botName);
        this.setupRailwayMonitoring();
    }

    saveDefaultConfig(botId, botName) {
        try {
            const config = {
                bots: [{
                    id: botId,
                    name: botName
                }]
            };
            
            fs.writeFileSync(this.botConfigFile, JSON.stringify(config, null, 2));
            console.log('💾 Default config saved');
        } catch (error) {
            console.error('⚠️ Save config error:', error.message);
        }
    }

    removeDuplicateBots(bots) {
        const unique = [];
        const seen = new Set();
        
        bots.forEach(bot => {
            const key = bot.name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(bot);
            }
        });
        
        return unique;
    }

    setupRailwayMonitoring() {
        console.log('🔍 Setting up Railway monitoring...');
        
        // Health check every 2 minutes
        setInterval(() => {
            const readyBots = Array.from(this.bots.values()).filter(bot => bot.isReady).length;
            const totalBots = this.bots.size;
            const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            const uptime = Math.floor(process.uptime());
            
            console.log(`💓 Railway Health Check:`);
            console.log(`   🤖 Ready: ${readyBots}/${totalBots}`);
            console.log(`   💾 Memory: ${memory}MB`);
            console.log(`   ⏰ Uptime: ${uptime}s`);
            
            // Memory warning
            if (memory > 400) {
                console.log('⚠️ HIGH MEMORY USAGE WARNING');
            }
            
        }, 120000); // 2 minutes
        
        // Keep alive every 5 minutes
        setInterval(() => {
            console.log(`🚂 Railway Keep-Alive - ${new Date().toISOString()}`);
            
            // Restart if no bots are ready for 10+ minutes
            const readyBots = Array.from(this.bots.values()).filter(bot => bot.isReady);
            if (readyBots.length === 0 && process.uptime() > 600) {
                console.log('🚨 No ready bots for 10+ minutes - restarting...');
                process.exit(1);
            }
            
        }, 300000); // 5 minutes
        
        // Cleanup disconnected bots
        setInterval(() => {
            let cleanupCount = 0;
            
            for (const [id, bot] of this.bots) {
                if (!bot.isReady && !bot.isAuthenticated) {
                    console.log(`🧹 Cleaning up bot: ${bot.botName}`);
                    this.bots.delete(id);
                    cleanupCount++;
                }
            }
            
            if (cleanupCount > 0) {
                console.log(`✅ Cleaned up ${cleanupCount} inactive bot(s)`);
            }
            
        }, 600000); // 10 minutes
    }

    // Local methods for non-Railway environments
    loadBotConfig() {
        if (this.isLoading) return;
        this.isLoading = true;
        
        try {
            if (fs.existsSync(this.botConfigFile)) {
                const config = JSON.parse(fs.readFileSync(this.botConfigFile, 'utf8'));
                
                if (config.bots?.length > 0) {
                    console.log('🔄 Loading saved bots...');
                    
                    const uniqueBots = this.removeDuplicateBots(config.bots);
                    
                    uniqueBots.forEach(botInfo => {
                        const bot = new WhatsAppBot(botInfo.id, botInfo.name);
                        this.bots.set(botInfo.id, bot);
                        this.botNames.add(botInfo.name.toLowerCase());
                        
                        bot.start();
                        console.log(`🤖 Loading: ${botInfo.name}`);
                    });
                    
                    setTimeout(() => this.showMenu(), 3000);
                } else {
                    this.showMenu();
                }
            } else {
                this.showMenu();
            }
        } catch (error) {
            console.error('❌ Load config error:', error.message);
            this.showMenu();
        }
    }

    showMenu() {
        if (isRailway) return; // No menu for Railway
        
        console.log('\n╔══════════════════════════════════════╗');
        console.log('║        WHATSAPP BOT MANAGER          ║');
        console.log('╚══════════════════════════════════════╝');
        console.log('1. Tambah Bot');
        console.log('2. List Bot');
        console.log('3. Hapus Bot');
        console.log('4. Keluar');
        console.log('═══════════════════════════════════════');
        
        this.rl.question('Pilih (1-4): ', (choice) => {
            this.handleMenuChoice(choice);
        });
    }

    handleMenuChoice(choice) {
        switch (choice) {
            case '1':
                this.addBot();
                break;
            case '2':
                this.listBots();
                break;
            case '3':
                this.removeBot();
                break;
            case '4':
                this.exit();
                break;
            default:
                console.log('❌ Invalid choice!');
                this.showMenu();
        }
    }

    addBot() {
        this.rl.question('Bot name: ', (name) => {
            if (!name.trim()) {
                console.log('❌ Name required!');
                this.showMenu();
                return;
            }

            const trimmedName = name.trim();
            const lowerName = trimmedName.toLowerCase();
            
            if (this.botNames.has(lowerName)) {
                console.log(`❌ Name "${trimmedName}" already exists!`);
                this.showMenu();
                return;
            }

            const botId = Date.now() + Math.floor(Math.random() * 1000);
            const bot = new WhatsAppBot(botId, trimmedName);
            
            this.bots.set(botId, bot);
            this.botNames.add(lowerName);

            bot.start();
            console.log(`✅ Bot "${trimmedName}" added with ID: ${botId}!`);
            
            this.saveBotConfig();
            
            setTimeout(() => this.showMenu(), 2000);
        });
    }

    removeBot() {
        if (this.bots.size === 0) {
            console.log('❌ No active bots.');
            setTimeout(() => this.showMenu(), 2000);
            return;
        }

        console.log('\n📋 ACTIVE BOTS:');
        console.log('═══════════════════════════════════════');
        
        this.bots.forEach((bot, id) => {
            const status = bot.isReady ? '🟢 Ready' : '🔴 Not Ready';
            console.log(`${id}. ${bot.botName} - ${status}`);
        });

        this.rl.question('\nBot ID to remove: ', async (botId) => {
            const id = parseInt(botId);
            
            if (this.bots.has(id)) {
                const bot = this.bots.get(id);
                const botName = bot.botName;
                
                await bot.stop();
                this.bots.delete(id);
                this.botNames.delete(botName.toLowerCase());
                
                // Remove auth folder
                const authFolder = path.join(__dirname, '.wwebjs_auth', `session-bot-${id}`);
                try {
                    if (fs.existsSync(authFolder)) {
                        fs.rmSync(authFolder, { recursive: true, force: true });
                    }
                } catch (error) {
                    console.error(`⚠️ Auth folder cleanup error: ${error.message}`);
                }
                
                this.saveBotConfig();
                console.log(`✅ Bot "${botName}" removed!`);
            } else {
                console.log('❌ Bot not found!');
            }
            
            setTimeout(() => this.showMenu(), 2000);
        });
    }

    listBots() {
        console.log('\n📋 ACTIVE BOTS:');
        console.log('═══════════════════════════════════════');
        
        if (this.bots.size === 0) {
            console.log('❌ No active bots.');
        } else {
            this.bots.forEach((bot, id) => {
                const status = bot.isReady ? '🟢 Ready' : '🔴 Not Ready';
                const auth = bot.isAuthenticated ? '🔐 Auth' : '🔓 No Auth';
                console.log(`ID: ${id}`);
                console.log(`Name: ${bot.botName}`);
                console.log(`Status: ${status}`);
                console.log(`Auth: ${auth}`);
                console.log('─────────────────────────────────────');
            });
        }
        
        setTimeout(() => this.showMenu(), 3000);
    }

    saveBotConfig() {
        try {
            const config = {
                bots: Array.from(this.bots.values()).map(bot => ({
                    id: bot.botId,
                    name: bot.botName
                }))
            };
            
            fs.writeFileSync(this.botConfigFile, JSON.stringify(config, null, 2));
        } catch (error) {
            console.error('❌ Save config error:', error.message);
        }
    }

    async exit() {
        console.log('🛑 Stopping all bots...');
        
        for (const bot of this.bots.values()) {
            await bot.stop();
        }
        
        if (this.rl) {
            this.rl.close();
        }
        
        console.log('👋 Goodbye!');
        process.exit(0);
    }

    start() {
        const environment = isRailway ? 'Railway 🚂' : 'Local 💻';
        console.log(`🚀 WhatsApp Bot Manager Started on ${environment}`);
        
        if (!isRailway) {
            console.log('💡 Saved bots will auto-login...\n');
        }
    }
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
    console.log('\n🛑 Graceful shutdown...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 SIGTERM received - shutting down...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error.message);
    
    if (isRailway) {
        console.error('🚂 Railway uncaught error:', error.stack);
        setTimeout(() => process.exit(1), 5000);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', promise, 'reason:', reason);
    
    if (isRailway) {
        console.error('🚂 Railway unhandled rejection');
    }
});

// Start the bot manager
const manager = new BotManager();
manager.start();

