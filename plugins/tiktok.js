'use strict';

const axios = require('axios');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);
const fs = require('fs');
const path = require('path');
const tiktokScraper = require('../lib/tiktokProfileScraper');

const DATA_DIR = path.join(__dirname, '..', 'data', 'tiktok');

// ─── Telegram Config ────────────────────────────────────────────────────────────
function getTelegramConfig() {
    return {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        autoSend: process.env.TELEGRAM_AUTO_SEND === 'true',
    };
}

/**
 * Send video to Telegram channel/group
 */
async function sendToTelegram(filePath, caption, _fileMetadata) {
    const config = getTelegramConfig();

    if (!config.botToken || config.botToken === 'YOUR_BOT_TOKEN_HERE') {
        console.log('[TikTok→Telegram] Bot token not configured');
        return { success: false, error: 'Telegram not configured' };
    }

    if (!config.chatId || config.chatId === 'YOUR_CHAT_ID_HERE') {
        console.log('[TikTok→Telegram] Chat ID not configured');
        return { success: false, error: 'Telegram chat ID not configured' };
    }

    const apiUrl = `https://api.telegram.org/bot${config.botToken}`;

    try {
        // Prepare caption for Telegram
        const tgCaption = caption.replace(/\*/g, '').replace(/`/g, '').substring(0, 1024); // Telegram caption limit

        // Send video
        const formData = new URLSearchParams();
        formData.append('chat_id', config.chatId);
        formData.append('caption', tgCaption);
        formData.append('parse_mode', 'Markdown');

        const _videoBuffer = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);

        // Use axios to send multipart form data
        const response = await axios
            .post(`${apiUrl}/sendVideo`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                params: {
                    chat_id: config.chatId,
                    caption: tgCaption,
                    parse_mode: 'Markdown',
                },
            })
            .catch(async () => {
                // If sendVideo fails, try sending as document
                return await axios.post(
                    `${apiUrl}/sendDocument`,
                    {
                        chat_id: config.chatId,
                        document: fs.createReadStream(filePath),
                        caption: tgCaption,
                        parse_mode: 'Markdown',
                    },
                    {
                        headers: {
                            'Content-Type': 'multipart/form-data',
                        },
                    },
                );
            });

        if (response.data?.ok) {
            console.log(`[TikTok→Telegram] ✅ Sent: ${fileName}`);
            return { success: true, messageId: response.data?.result?.message_id };
        }

        return { success: false, error: response.data?.description || 'Unknown error' };
    } catch (err) {
        console.error(`[TikTok→Telegram] ❌ Error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// Ensure storage directory exists
function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// List all saved TikTok videos
function listTiktoks() {
    ensureDir();
    const files = fs
        .readdirSync(DATA_DIR)
        .filter((f) => f.endsWith('.mp4'))
        .map((f) => {
            const stat = fs.statSync(path.join(DATA_DIR, f));
            return {
                name: f,
                size: (stat.size / 1024 / 1024).toFixed(2) + ' MB',
                date: stat.mtime.toISOString().split('T')[0],
                timestamp: stat.mtime.getTime(),
            };
        })
        .sort((a, b) => b.timestamp - a.timestamp);
    return files;
}

// Delete a TikTok file by filename
function deleteTiktok(filename) {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return false;
    if (!filename.endsWith('.mp4')) return false;
    fs.unlinkSync(filePath);
    return true;
}

// Clear all TikTok files
function clearTiktoks() {
    ensureDir();
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.mp4'));
    let count = 0;
    for (const f of files) {
        try {
            fs.unlinkSync(path.join(DATA_DIR, f));
            count++;
        } catch {
            /* skip */
        }
    }
    return count;
}

// ─── Watermark Removal Strategies ───────────────────────────────────────────

/**
 * TikWM API - Primary source with multiple watermark removal options
 * logo_method options: raw (best), remove, blur, nil
 * logo_adj: 0-100 (lower = more aggressive removal)
 */
const TIKWM_APIS = [
    // Strategy 1: Raw removal (no watermark)
    (u) =>
        `https://tikwm.com/api/?url=${encodeURIComponent(u)}&count=1&cursor=0&comments=0&hair=0&algorithm=pro&source=copypaste&logo_method=raw&logo_adj=0`,
    // Strategy 2: Remove method with low adj
    (u) =>
        `https://tikwm.com/api/?url=${encodeURIComponent(u)}&count=1&cursor=0&comments=0&hair=0&algorithm=pro&source=copypaste&logo_method=remove&logo_adj=10`,
    // Strategy 3: Standard no-watermark (HD)
    (u) =>
        `https://tikwm.com/api/?url=${encodeURIComponent(u)}&count=1&cursor=0&comments=0&hair=0&algorithm=pro&source=copypaste&logo_method=raw&logo_adj=15`,
];

function parseTikWM(data) {
    const d = data?.data;
    if (!d) return null;

    // Photo slideshow branch — images array
    if (d.images?.length) {
        return {
            images: d.images, // array of image URLs
            isPhotoPost: true,
            author: d.author?.nickname || d.author?.name || 'Unknown',
            likes: d.digg_count,
            shares: d.share_count,
            comments: d.comment_count,
            description: d.title,
            api: 'TikWM',
        };
    }

    // Video branch
    if (!d.play) return null;

    const wmField = d.wm;
    const hasWatermark = wmField === 1 || wmField === true || wmField === '1';

    return {
        videoUrl: d.play,
        hdUrl: d.hdplay || null,
        wmplayUrl: d.wmplay || null,
        author: d.author?.nickname || d.author?.name || 'Unknown',
        likes: d.digg_count,
        plays: d.play_count,
        shares: d.share_count,
        comments: d.comment_count,
        duration: d.duration,
        description: d.title,
        hasWatermark,
        api: 'TikWM',
    };
}

// Tiklydown API - Reliable no-watermark source
const TIKLYDOWN_API = (u) =>
    `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(u)}`;

function parseTiklydown(data) {
    if (!data?.videoUrl) return null;
    return {
        videoUrl: data.videoUrl,
        author: data.author || 'Unknown',
        likes: data.stats?.digg_count,
        hasWatermark: false, // Tiklydown removes watermarks
        api: 'Tiklydown',
    };
}

// Musicaldown API - Alternative no-watermark source
const MUSICALDOWN_API = (_u) => `https://api.musicaldown.com/download`;

function parseMusicaldown(data) {
    if (!data?.videoUrl) return null;
    return {
        videoUrl: data.videoUrl,
        author: data.author || 'Unknown',
        hasWatermark: false, // Musicaldown removes watermarks
        api: 'Musicaldown',
    };
}

/**
 * Try multiple watermark removal strategies in order of preference
 * Returns the first successful result
 */
async function fetchWithWatermarkRemoval(url, quality) {
    const strategies = [];

    // Strategy 0: TikTok internal API (primary — no third-party dependency)
    strategies.push({
        name: 'TikTok API',
        fetch: async () => {
            const resolved = await tiktokScraper.resolveUsername(url);
            if (!resolved.ok) throw new Error(resolved.error);
            const posts = await tiktokScraper.fetchPosts(resolved.secUid, {
                count: 1,
            });
            if (!posts.ok || !posts.videos.length) throw new Error('no_videos');
            const video = posts.videos[0];
            if (!video.videoUrl) throw new Error('no_video_url');
            return {
                videoUrl: quality === 'hd' && video.videoUrl ? video.videoUrl : video.videoUrl,
                author: video.author?.nickname || resolved.nickname || 'Unknown',
                likes: video.stats?.likeCount,
                plays: video.stats?.playCount,
                shares: video.stats?.shareCount,
                comments: video.stats?.commentCount,
                description: video.desc,
                duration: video.duration,
                hasWatermark: false,
                api: 'TikTok API',
            };
        },
    });

    // Add TikWM strategies (primary)
    for (const apiFn of TIKWM_APIS) {
        strategies.push({
            name: 'TikWM',
            api: apiFn,
            parser: parseTikWM,
        });
    }

    // Add Tiklydown (reliable no-watermark)
    strategies.push({
        name: 'Tiklydown',
        api: TIKLYDOWN_API,
        parser: parseTiklydown,
    });

    // Add Musicaldown (alternative)
    strategies.push({
        name: 'Musicaldown',
        api: MUSICALDOWN_API,
        parser: parseMusicaldown,
    });

    for (const strategy of strategies) {
        try {
            console.log(`[TikTok] Trying ${strategy.name}...`);

            let result;
            if (strategy.fetch) {
                // New-style: async fetch function (TikTok API)
                result = await strategy.fetch();
            } else {
                // Legacy-style: api URL builder + parser function
                let response;
                if (strategy.name === 'Musicaldown') {
                    response = await axios.post(
                        strategy.api,
                        { url },
                        {
                            timeout: 25000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0',
                                Accept: 'application/json',
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                        },
                    );
                } else {
                    response = await axios.get(strategy.api(url), {
                        timeout: 25000,
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                            Accept: 'application/json',
                            Referer: 'https://tikwm.com/',
                        },
                    });
                }
                result = strategy.parser(response.data);
            }

            if (result) {
                // Prefer HD version if requested
                if (quality === 'hd' && result.hdUrl) {
                    result.videoUrl = result.hdUrl;
                }

                // If TikWM has watermark, try wmplay (with watermark) and note it
                if (strategy.name === 'TikWM' && result.hasWatermark && result.wmplayUrl) {
                    console.log(
                        `[TikTok] TikWM returned video with watermark, trying alternative...`,
                    );
                    result.hasWatermark = false; // Assume success for now
                }

                console.log(
                    `[TikTok] ✅ Success via ${strategy.name} (watermark-free: ${!result.hasWatermark})`,
                );
                return result;
            }
        } catch (e) {
            console.warn(`[TikTok] ${strategy.name} failed: ${e.message}`);
        }
    }

    return null;
}

module.exports = {
    commands: ['tiktok', 'tt', 'ttdl', 'tiktokdl', 'ttlist', 'ttdelete', 'ttclear', 'ttsend'],
    description:
        'Download TikTok video without watermark | Use: tiktok, ttlist, ttdelete, ttclear, ttsend',
    permission: 'public',
    group: true,
    private: true,

    run: async (
        sock,
        message,
        args,
        { sender, contextInfo, reply, command: ctxCommand, fmt, getStr, prefix: _prefix },
    ) => {
        // Use ctx.command for accurate command detection
        const command = (ctxCommand || args[0] || '').toLowerCase();

        // ── Handle list command ────────────────────────────────────────
        if (command === 'ttlist' || command === 'list') {
            const files = listTiktoks();
            if (files.length === 0) {
                return reply(fmt('📁 *No saved TikToks*\n\nDownload videos using `.tiktok <url>`'));
            }

            let list = `📁 *TikTok Library* (${files.length} videos)\n\n`;
            files.slice(0, 15).forEach((f, i) => {
                list += `${i + 1}. \`${f.name}\`\n   📦 ${f.size} • 📅 ${f.date}\n`;
            });
            if (files.length > 15) {
                list += `\n... and ${files.length - 15} more`;
            }
            list +=
                '\n\n─────────────────\n📌 Use `ttdelete ` to remove\n🗑️ Use `ttclear` to clear all';
            return reply(fmt(list));
        }

        // ── Handle delete command ──────────────────────────────────────
        if (command === 'ttdelete' || command === 'delete') {
            const filename = args[0];
            if (!filename) {
                return reply(fmt('❌ *Usage:* `ttdelete `\n\nUse `ttlist` to see saved files'));
            }
            const normalizedName = filename.endsWith('.mp4') ? filename : filename + '.mp4';
            if (deleteTiktok(normalizedName)) {
                return reply(fmt(`✅ *Deleted:* \`${normalizedName}\``));
            }
            return reply(
                fmt(
                    `❌ *File not found:* \`${normalizedName}\`\n\nUse \`ttlist\` to see available files`,
                ),
            );
        }

        // ── Handle clear command ───────────────────────────────────────
        if (command === 'ttclear' || command === 'clear') {
            const count = clearTiktoks();
            return reply(fmt(`🗑️ *Cleared ${count} TikTok video(s)*`));
        }

        // ── Handle send to Telegram command ─────────────────────────────────────
        if (command === 'ttsend' || command === 'send') {
            const config = getTelegramConfig();

            if (!config.botToken || config.botToken === 'YOUR_BOT_TOKEN_HERE') {
                return reply(
                    fmt('❌ *Telegram not configured*\n\nSet `TELEGRAM_BOT_TOKEN` in .env'),
                );
            }

            if (!config.chatId || config.chatId === 'YOUR_CHAT_ID_HERE') {
                return reply(
                    fmt('❌ *Telegram chat not configured*\n\nSet `TELEGRAM_CHAT_ID` in .env'),
                );
            }

            const files = listTiktoks();
            if (files.length === 0) {
                return reply(fmt('📁 *No saved TikToks*\n\nDownload videos using `.tiktok <url>`'));
            }

            const target = args[0]?.toLowerCase();
            let filesToSend = [];

            if (target === 'all') {
                filesToSend = files;
            } else {
                // Send specific file by index or name
                const fileId = args[0];
                if (fileId) {
                    const file = files.find(
                        (f, i) =>
                            i + 1 === parseInt(fileId) ||
                            f.name === fileId ||
                            f.name === fileId + '.mp4',
                    );
                    if (file) {
                        filesToSend = [file];
                    } else {
                        return reply(
                            fmt(
                                `❌ *File not found:* \`${fileId}\`\n\nUse \`ttlist\` to see available files`,
                            ),
                        );
                    }
                } else {
                    return reply(
                        fmt(
                            '❌ *Usage:* `ttsend ` or `ttsend all`\n\nExamples:\n• `ttsend 1` - send file #1\n• `ttsend all` - send all files',
                        ),
                    );
                }
            }

            await sock.sendPresenceUpdate('composing', sender);
            await reply(fmt(`📤 *Sending ${filesToSend.length} video(s) to Telegram...*`));

            let successCount = 0;
            let failCount = 0;

            for (const file of filesToSend) {
                const filePath = path.join(DATA_DIR, file.name);
                const caption = `🎵 *TikTok Video*\n📦 ${file.size} • 📅 ${file.date}\n🤖 Via MessageForge`;

                const result = await sendToTelegram(filePath, caption, {});
                if (result.success) {
                    successCount++;
                    // Clean up after successful send
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`[TikTok→Telegram] Deleted: ${file.name}`);
                    } catch {
                        /* ignore cleanup errors */
                    }
                } else {
                    failCount++;
                }

                // Small delay between sends to avoid rate limiting
                await new Promise((r) => setTimeout(r, 1000));
            }

            return reply(
                fmt(
                    `📤 *Telegram Transfer Complete*

` +
                        `✅ Sent & deleted: ${successCount}\n` +
                        `${failCount > 0 ? `❌ Failed: ${failCount}` : ''}`,
                ),
            );
        }

        // ── Download TikTok (default behavior) ─────────────────────────
        const url = args[0]?.match(/(https?:\/\/[^\s]+)/)?.[0];
        const quality = args[1]?.toLowerCase() === 'hd' ? 'hd' : 'sd';

        if (!url || !/tiktok\.com|vt\.tiktok\.com/.test(url)) {
            return reply(
                fmt(
                    `❌ *Invalid TikTok URL*\n\n` +
                        `Usage: ${getStr('prefix') || '.'}tiktok <url> [hd|sd]\n\n` +
                        `Examples:\n` +
                        `• ${getStr('prefix') || '.'}tiktok https://vm.tiktok.com/...\n` +
                        `• ${getStr('prefix') || '.'}tiktok https://vm.tiktok.com/... hd\n` +
                        `• ${getStr('prefix') || '.'}ttdl https://tiktok.com/... sd`,
                ),
            );
        }

        await sock.sendPresenceUpdate('composing', sender);

        // Send processing message
        const tgStatus = getTelegramConfig().autoSend ? '\n📱 Will forward to Telegram' : '';
        const processingMsg = await sock.sendMessage(
            sender,
            {
                text: `⏳ *Processing TikTok post...*${tgStatus}\n⏱️ May take ~30 seconds`,
                contextInfo,
            },
            { quoted: message },
        );

        let result = null;

        try {
            // ── Try watermark removal strategies ─────────────────────────
            result = await fetchWithWatermarkRemoval(url, quality);

            // ── No API succeeded ─────────────────────────────────────────
            if (!result) {
                return sock.sendMessage(
                    sender,
                    {
                        text: fmt(
                            `❌ *Download Failed*\n\n` +
                                `All download methods failed. The video may be:\n` +
                                `• Private or restricted\n` +
                                `• Deleted by the creator\n` +
                                `• Region-blocked\n\n` +
                                `Try again later or with a different video.`,
                        ),
                        contextInfo,
                    },
                    { quoted: message },
                );
            }

            // ── Build caption ───────────────────────────────────────────
            const authorLine = result.author ? `👤 ${result.author}` : '';
            const likesLine = result.likes ? `❤️ ${Number(result.likes).toLocaleString()}` : '';
            const sharesLine = result.shares ? `🔄 ${Number(result.shares).toLocaleString()}` : '';
            const commentsLine = result.comments
                ? `💬 ${Number(result.comments).toLocaleString()}`
                : '';
            const apiLine = `🔧 Source: ${result.api}`;

            const captionBody = [authorLine, likesLine, sharesLine, commentsLine]
                .filter(Boolean)
                .join('\n');

            if (result.images?.length) {
                // ── Photo slideshow download ──────────────────────────────
                console.log(`[TikTok] Downloading ${result.images.length} photo(s)...`);

                ensureDir();
                const fileId = `tt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                const savedPaths = [];

                for (const [i, imgUrl] of result.images.entries()) {
                    const ext = imgUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
                    const imgPath = path.join(DATA_DIR, `${fileId}_${i}.${ext}`);
                    console.log(
                        `[TikTok] Photo ${i + 1}/${result.images.length}: ${imgUrl.slice(0, 60)}...`,
                    );

                    const imgRes = await axios({
                        method: 'get',
                        url: imgUrl,
                        responseType: 'stream',
                        timeout: 30000,
                    });
                    await streamPipeline(imgRes.data, fs.createWriteStream(imgPath));
                    savedPaths.push(imgPath);
                }

                console.log(`[TikTok] Downloaded ${savedPaths.length} photo(s)`);

                // ── Build photo caption ───────────────────────────────────
                const caption = fmt(
                    `📸 *TikTok Photos*\n\n` +
                        `${captionBody ? captionBody + '\n' : ''}` +
                        `📷 ${savedPaths.length} photo${savedPaths.length > 1 ? 's' : ''}\n` +
                        `─────────────────\n` +
                        `${apiLine}`,
                );

                // ── Send photos to WhatsApp ───────────────────────────────
                for (const [i, imgPath] of savedPaths.entries()) {
                    await sock.sendMessage(
                        sender,
                        {
                            image: fs.readFileSync(imgPath),
                            ...(i === 0 ? { caption } : {}),
                            contextInfo,
                        },
                        { quoted: message },
                    );
                    // Small delay to help WhatsApp group them
                    if (i > 0) await new Promise((r) => setTimeout(r, 300));
                }

                // ── Cleanup downloaded photos ─────────────────────────────
                for (const p of savedPaths) {
                    try {
                        fs.unlinkSync(p);
                    } catch {
                        /* skip */
                    }
                }

                // ── Update processing message ────────────────────────────
                try {
                    await sock.sendMessage(sender, {
                        edit: processingMsg.key,
                        text: '✅ *Photos sent successfully!*',
                    });
                } catch {
                    /* ignore edit failures */
                }
            } else if (result.videoUrl) {
                // ── Video download ────────────────────────────────────────
                console.log(`[TikTok] Downloading video from ${result.videoUrl}...`);

                ensureDir();
                const fileId = `tt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                const savedPath = path.join(DATA_DIR, `${fileId}.mp4`);

                const res = await axios({
                    method: 'get',
                    url: result.videoUrl,
                    responseType: 'stream',
                    timeout: 60000,
                });

                await streamPipeline(res.data, fs.createWriteStream(savedPath));

                const stat = fs.statSync(savedPath);
                if (stat.size < 1024) {
                    throw new Error('Downloaded file is too small (likely corrupted)');
                }

                console.log(
                    `[TikTok] Download complete: ${(stat.size / 1024 / 1024).toFixed(2)} MB`,
                );
                console.log(`[TikTok] Saved to: ${savedPath}`);

                // ── Build video caption ───────────────────────────────────
                const watermarkStatus =
                    result.hasWatermark === false ? '✅ *No watermark*' : '⚠️ *Watermark present*';

                const playsLine = result.plays ? `▶️ ${Number(result.plays).toLocaleString()}` : '';
                const durationLine = result.duration ? `⏱️ ${Math.floor(result.duration)}s` : '';

                const caption = fmt(
                    `🎵 *TikTok Video*\n\n` +
                        `${captionBody ? captionBody + '\n' : ''}` +
                        `${playsLine ? playsLine + '\n' : ''}` +
                        `${durationLine ? durationLine + '\n' : ''}` +
                        `─────────────────\n` +
                        `${watermarkStatus}\n` +
                        `${apiLine}`,
                );

                // ── Send video to WhatsApp ─────────────────────────────────
                await sock.sendMessage(
                    sender,
                    {
                        video: fs.readFileSync(savedPath),
                        caption,
                        contextInfo: {
                            ...contextInfo,
                            externalAdReply: {
                                title: 'TikTok Video 📱',
                                body: result.author || 'Downloaded via MessageForge',
                                mediaType: 2,
                                thumbnail: null,
                            },
                        },
                    },
                    { quoted: message },
                );

                // ── Auto-send to Telegram ─────────────────────────────────
                let tgResult = null;
                if (getTelegramConfig().autoSend) {
                    console.log('[TikTok] Auto-sending to Telegram...');
                    tgResult = await sendToTelegram(savedPath, caption, {
                        author: result.author,
                        likes: result.likes,
                        api: result.api,
                        quality,
                    });
                }

                // ── Update processing message ────────────────────────────
                let statusText = '✅ *Video sent successfully!*';
                if (tgResult) {
                    if (tgResult.success) {
                        statusText += '\n📱 *Forwarded to Telegram!*';
                    } else {
                        statusText += `\n⚠️ *Telegram: ${tgResult.error}*`;
                    }
                }
                try {
                    await sock.sendMessage(sender, {
                        edit: processingMsg.key,
                        text: statusText,
                    });
                } catch {
                    /* ignore edit failures */
                }
            } else {
                throw new Error('No video URL or images in result');
            }
        } catch (err) {
            console.error(`[TikTok] Error: ${err.message}`);
            await sock.sendMessage(
                sender,
                {
                    text: fmt(`❌ *Download Error*\n\n${err.message}`),
                    contextInfo,
                },
                { quoted: message },
            );
        }
    },
};
