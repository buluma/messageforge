'use strict';

const tiktokScraper = require('../lib/tiktokProfileScraper');

function fmtNum(n) {
    if (n === undefined || n === null) return 'N/A';
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

function barOf(value, max, len = 12) {
    if (!max) return '▱'.repeat(len);
    const filled = Math.round((value / max) * len);
    return '▰'.repeat(Math.min(filled, len)) + '▱'.repeat(Math.max(len - filled, 0));
}

module.exports = {
    commands: ['tiktokstalk', 'ttstalk', 'tksearch', 'ttuser', 'tikstalk'],
    description: 'Stalk a TikTok profile — followers, videos, likes, bio and more',
    category: 'search',
    usage: '.tiktokstalk <username>',
    permission: 'public',
    group: true,
    private: true,

    run: async (sock, message, args, { jid, contextInfo, reply, fmt, getStr }) => {
        let username = args[0]?.replace(/^@/, '').trim();
        if (!username) {
            return reply(
                fmt('🎵 Please provide a TikTok username.\nExample: `.ttstalk charlidamelio`'),
            );
        }

        await sock.sendPresenceUpdate('composing', jid);
        await sock.sendMessage(
            jid,
            { text: fmt(`⏳ Fetching TikTok profile for @${username}…`), contextInfo },
            { quoted: message },
        );

        const result = await tiktokScraper.getProfileWithPosts(username);

        if (!result.ok) {
            const msg =
                result.error === 'user_not_found'
                    ? `❌ TikTok user *@${username}* not found.`
                    : result.error === 'secUid_not_found'
                      ? `❌ Could not resolve @${username} — profile may be private or region-restricted.`
                      : `❌ TikTok API error: ${result.error}`;
            return reply(fmt(msg));
        }

        const u = result.profile;

        const followers = u.followerCount ?? u.follower_count ?? u.fans ?? 0;
        const following = u.followingCount ?? u.following_count ?? u.following ?? 0;
        const likes = u.heartCount ?? u.heart_count ?? u.heart ?? u.digg_count ?? u.diggCount ?? 0;
        const videos = u.videoCount ?? u.video_count ?? u.video ?? u.awemeCount ?? 0;
        const friends = u.friendCount ?? u.friend_count ?? u.friend ?? 0;
        const maxVal = Math.max(followers, likes, 1);

        const badges = [];
        if (u.verified) badges.push('✅ Verified');
        if (u.privateAccount || u.secret || u.private) badges.push('🔒 Private account');
        if (u.isUnderAge18) badges.push('🔞 Under 18');
        if (u.openFavorite) badges.push('⭐ Favorites public');
        if (u.commentSetting === 1) badges.push('💬 Comments: Friends only');
        if (u.commentSetting === 2) badges.push('💬 Comments: Off');
        if (!u.verified && followers > 1_000_000) badges.push('🚀 1M+ unverified mega creator');

        const region = u.region || u.country || null;

        const lines = [];
        lines.push(`┌──────────────────────┐`);
        lines.push(` 🎵 *Profile Report*`);
        lines.push(`└──────────────────────┘`);
        lines.push('');

        lines.push(`*🆔 Identity*`);
        lines.push(`• *Username:* @${u.uniqueId || username}`);
        if (u.nickname) lines.push(`• *Display Name:* ${u.nickname}`);
        if (u.userId || u.id) lines.push(`• *User ID:* \`${u.userId || u.id}\``);
        if (region) lines.push(`• *Region:* ${region}`);
        if (u.language) lines.push(`• *Language:* ${u.language}`);
        lines.push('');

        if (u.signature) {
            lines.push(`*📝 Bio*`);
            lines.push(u.signature.slice(0, 300));
            lines.push('');
        }

        lines.push(`*📊 Stats*`);
        lines.push(`• *Followers:* ${fmtNum(followers)}  ${barOf(followers, maxVal)}`);
        lines.push(`• *Following:* ${fmtNum(following)}`);
        if (friends) lines.push(`• *Friends:*   ${fmtNum(friends)}`);
        lines.push(`• *Likes (total received):* ❤️ ${fmtNum(likes)}  ${barOf(likes, maxVal)}`);
        lines.push(`• *Videos posted:* 🎬 ${fmtNum(videos)}`);
        if (followers && videos) {
            const ratio = Math.round(likes / videos);
            lines.push(`• *Avg likes/video:* ~${fmtNum(ratio)}`);
        }
        lines.push('');

        lines.push(`*⚙️ Account Settings*`);
        lines.push(
            `• *Private:* ${u.privateAccount || u.secret || u.private ? '🔒 Yes' : '🔓 No'}`,
        );
        lines.push(
            `• *Duet:* ${u.duetSetting === 0 ? '✅ Open' : u.duetSetting === 1 ? '👥 Friends' : '❌ Off'}`,
        );
        lines.push(
            `• *Stitch:* ${u.stitchSetting === 0 ? '✅ Open' : u.stitchSetting === 1 ? '👥 Friends' : '❌ Off'}`,
        );
        lines.push(
            `• *Comment:* ${u.commentSetting === 0 ? '✅ Everyone' : u.commentSetting === 1 ? '👥 Friends' : '❌ Off'}`,
        );
        lines.push('');

        if (badges.length) {
            lines.push(`*🏷️ Badges*`);
            badges.forEach((b) => lines.push(`• ${b}`));
            lines.push('');
        }

        if (result.videos.length) {
            const recent = result.videos[0];
            const stat = recent.stats || {};
            lines.push('');
            lines.push(`*🎥 Latest Video*`);
            lines.push(`• "${(recent.desc || 'Untitled').slice(0, 80)}"`);
            lines.push(
                `• ❤️ ${fmtNum(stat.likeCount)} · 💬 ${fmtNum(stat.commentCount)} · 🔄 ${fmtNum(stat.shareCount)}`,
            );
        }
        lines.push('');

        lines.push(`• *Profile:* https://www.tiktok.com/@${u.uniqueId || username}`);
        lines.push(`_Powered by ${getStr('botName') || 'MessageForge'} · TikTok API_`);

        const avatarUrl = u.avatar || u.avatarLarger || u.avatarMedium || u.avatarThumb || null;

        try {
            if (avatarUrl) {
                await sock.sendMessage(
                    jid,
                    {
                        image: { url: avatarUrl },
                        caption: fmt(lines.join('\n')),
                        contextInfo,
                    },
                    { quoted: message },
                );
            } else {
                await reply(fmt(lines.join('\n')));
            }
        } catch {
            await reply(fmt(lines.join('\n')));
        }
    },
};
