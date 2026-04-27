'use strict';

const axios         = require('axios');
const { pipeline }  = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);
const fs            = require('fs');
const os            = require('os');
const path          = require('path');
const { getStr, fmt } = require('../lib/theme');

const DATA_DIR = path.join(__dirname, '..', 'data', 'tiktok');

// Ensure storage directory exists
function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

// List all saved TikTok videos
function listTiktoks() {
    ensureDir();
    const files = fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith('.mp4'))
        .map(f => {
            const stat = fs.statSync(path.join(DATA_DIR, f));
            return {
                name: f,
                size: (stat.size / 1024 / 1024).toFixed(2) + ' MB',
                date: stat.mtime.toISOString().split('T')[0],
                timestamp: stat.mtime.getTime()
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
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.mp4'));
    let count = 0;
    for (const f of files) {
        try {
            fs.unlinkSync(path.join(DATA_DIR, f));
            count++;
        } catch { /* skip */ }
    }
    return count;
}

// TikWM API (primary - most reliable for watermark-free)
const TIKWM_API = (u, quality) => `https://tikwm.com/api/?url=${encodeURIComponent(u)}&count=1&cursor=0&comments=0&hair=0&algorithm=pro&source=copypaste&logo_method=raw&logo_adj=${quality === 'hd' ? 15 : 25}`;

// TikWM response parser
function parseTikWM(data) {
    if (!data?.data?.play) return null;
    return {
        videoUrl: data.data.play,
        hdUrl: data.data.hdplay || null,
        author: data.data.author?.nickname || data.data.author?.name || 'Unknown',
        likes: data.data.digg_count,
        plays: data.data.play_count,
        shares: data.data.share_count,
        comments: data.data.comment_count,
        duration: data.data.duration,
        description: data.data.title,
        watermark: data.data.wm || false,
        api: 'TikWM'
    };
}

// Tiklydown API (fallback)
const TIKLYDOWN_API = (u) => `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(u)}`;

function parseTiklydown(data) {
    if (!data?.videoUrl) return null;
    return {
        videoUrl: data.videoUrl,
        author: data.author || 'Unknown',
        likes: data.stats?.digg_count,
        watermark: false,
        api: 'Tiklydown'
    };
}

module.exports = {
    commands:    ['tiktok', 'tt', 'ttdl', 'tiktokdl', 'ttlist', 'ttdelete', 'ttclear'],
    description: 'Download TikTok video without watermark | Use: tiktok, ttlist, ttdelete, ttclear',
    permission:  'public',
    group:       true,
    private:     true,

    run: async (sock, message, args, { sender, contextInfo, reply }) => {
        const command = message.message?.extendedTextMessage?.contextInfo?.quotedMessage
            ? args[0] // If replying to a message, first arg is still the command
            : (args[0] || '').toLowerCase();

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
            list += '\n\n─────────────────\n📌 Use `ttdelete ` to remove\n🗑️ Use `ttclear` to clear all';
            return reply(fmt(list));
        }

        // ── Handle delete command ──────────────────────────────────────
        if (command === 'ttdelete' || command === 'delete') {
            const filename = args[1];
            if (!filename) {
                return reply(fmt('❌ *Usage:* `ttdelete `\n\nUse `ttlist` to see saved files'));
            }
            const normalizedName = filename.endsWith('.mp4') ? filename : filename + '.mp4';
            if (deleteTiktok(normalizedName)) {
                return reply(fmt(`✅ *Deleted:* \`${normalizedName}\``));
            }
            return reply(fmt(`❌ *File not found:* \`${normalizedName}\`\n\nUse \`ttlist\` to see available files`));
        }

        // ── Handle clear command ───────────────────────────────────────
        if (command === 'ttclear' || command === 'clear') {
            const count = clearTiktoks();
            return reply(fmt(`🗑️ *Cleared ${count} TikTok video(s)*`));
        }

        // ── Download TikTok (default behavior) ─────────────────────────
        const url = args[0]?.match(/(https?:\/\/[^\s]+)/)?.[0];
        const quality = args[1]?.toLowerCase() === 'hd' ? 'hd' : 'sd';

        if (!url || !/tiktok\.com|vt\.tiktok\.com/.test(url)) {
            return reply(fmt(
                `❌ *Invalid TikTok URL*\n\n` +
                `Usage: ${getStr('prefix') || '.'}tiktok <url> [hd|sd]\n\n` +
                `Examples:\n` +
                `• ${getStr('prefix') || '.'}tiktok https://vm.tiktok.com/...\n` +
                `• ${getStr('prefix') || '.'}tiktok https://vm.tiktok.com/... hd\n` +
                `• ${getStr('prefix') || '.'}ttdl https://tiktok.com/... sd`
            ));
        }

        await sock.sendPresenceUpdate('composing', sender);

        // Send processing message
        const processingMsg = await sock.sendMessage(sender, {
            text: `⏳ *Processing TikTok video...*\n🔗 Quality: *${quality.toUpperCase()}*\n💾 Will be saved to data/tiktok/\n⏱️ May take ~20 seconds`,
            contextInfo
        }, { quoted: message });
        let result = null;
        let errorMsg = null;

        try {
            // ── Try TikWM (primary) ──────────────────────────────────────
            console.log(`[TikTok] Trying TikWM (${quality.toUpperCase()})...`);
            try {
                const { data } = await axios.get(TIKWM_API(url, quality), {
                    timeout: 25000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                        'Accept': 'application/json',
                        'Referer': 'https://tikwm.com/'
                    }
                });

                if (data?.data?.play) {
                    result = parseTikWM(data);
                    result.quality = quality;
                    // Use HD URL if requested and available
                    if (quality === 'hd' && result.hdUrl) {
                        result.videoUrl = result.hdUrl;
                    }
                    console.log(`[TikTok] ✅ Success via TikWM (watermark: ${result.watermark ? 'yes' : 'no'})`);
                }
            } catch (e) {
                console.warn(`[TikTok] TikWM failed: ${e.message}`);
            }

            // ── Try Tiklydown (fallback) ─────────────────────────────────
            if (!result) {
                console.log('[TikTok] Trying Tiklydown...');
                try {
                    const { data } = await axios.get(TIKLYDOWN_API(url), {
                        timeout: 25000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0',
                            'Accept': 'application/json'
                        }
                    });

                    if (data?.videoUrl) {
                        result = parseTiklydown(data);
                        result.quality = 'sd';
                        console.log(`[TikTok] ✅ Success via Tiklydown (watermark: no)`);
                    }
                } catch (e) {
                    console.warn(`[TikTok] Tiklydown failed: ${e.message}`);
                    errorMsg = e.message;
                }
            }

            // ── No API succeeded ─────────────────────────────────────────
            if (!result) {
                return sock.sendMessage(sender, {
                    text: fmt(
                        `❌ *Download Failed*\n\n` +
                        `All APIs failed. The video may be:\n` +
                        `• Private or restricted\n` +
                        `• Deleted by the creator\n` +
                        `• Region-blocked\n\n` +
                        `Error: ${errorMsg || 'Unknown'}`
                    ),
                    contextInfo
                }, { quoted: message });
            }

            // ── Download video ────────────────────────────────────────────
            console.log(`[TikTok] Downloading video from ${result.videoUrl}...`);

            ensureDir();
            const fileId = `tt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const savedPath = path.join(DATA_DIR, `${fileId}.mp4`);

            const res = await axios({
                method: 'get',
                url: result.videoUrl,
                responseType: 'stream',
                timeout: 60000
            });

            await streamPipeline(res.data, fs.createWriteStream(savedPath));

            const stat = fs.statSync(savedPath);
            // Validate file size (minimum 1KB for valid video)
            if (stat.size < 1024) {
                throw new Error('Downloaded file is too small (likely corrupted)');
            }

            console.log(`[TikTok] Download complete: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`[TikTok] Saved to: ${savedPath}`);

            // ── Build caption ───────────────────────────────────────────
            const watermarkNote = result.watermark ? '⚠️ Watermark may be present' : '✅ No watermark';
            const authorLine = result.author ? `👤 ${result.author}` : '';
            const likesLine = result.likes ? `❤️ ${Number(result.likes).toLocaleString()}` : '';
            const playsLine = result.plays ? `▶️ ${Number(result.plays).toLocaleString()}` : '';
            const durationLine = result.duration ? `⏱️ ${Math.floor(result.duration)}s` : '';
            const apiLine = `🔧 Source: ${result.api}`;

            const caption = fmt(
                `🎵 *TikTok Download*\n\n` +
                `${authorLine ? authorLine + '\n' : ''}` +
                `${likesLine ? likesLine + '\n' : ''}` +
                `${playsLine ? playsLine + '\n' : ''}` +
                `${durationLine ? durationLine + '\n' : ''}` +
                `─────────────────\n` +
                `${watermarkNote}\n` +
                `${apiLine}`
            );

            // ── Send video ───────────────────────────────────────────────
            await sock.sendMessage(sender, {
                video: fs.readFileSync(savedPath),
                caption,
                contextInfo: {
                    ...contextInfo,
                    externalAdReply: {
                        title: 'TikTok Video 📱',
                        body: result.author || 'Downloaded via MessageForge',
                        mediaType: 2, // VIDEO
                        thumbnail: null
                    }
                }
            }, { quoted: message });

            // Edit processing message
            try {
                await sock.sendMessage(sender, {
                    edit: processingMsg.key,
                    text: '✅ *Video sent successfully!*'
                });
            } catch { /* ignore edit failures */ }

        } catch (err) {
            console.error(`[TikTok] Error: ${err.message}`);
            await sock.sendMessage(sender, {
                text: fmt(`❌ *Download Error*\n\n${err.message}`),
                contextInfo
            }, { quoted: message });
        } finally {
            // No temp file cleanup needed - file stays in data/tiktok/
        }
    }
};