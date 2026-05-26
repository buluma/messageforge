'use strict';

/**
 * TikTok profile scraper.
 *
 * Uses a two-phase approach:
 *   1. resolveUsername() — web-scrapes the TikTok profile page to extract
 *      secUid from __UNIVERSAL_DATA_FOR_REHYDRATION__ (or legacy payloads).
 *   2. fetchProfile() — calls TikTok's internal /aweme/v1/user/profile/ API
 *      for full stats (followers, likes, etc.).
 *   3. fetchPosts() — calls TikTok's internal /aweme/v1/aweme/post/ for
 *      video listing with pagination.
 *   4. getProfileWithPosts() — convenience wrapper for the stalk command.
 *
 * The internal API uses the same endpoint, headers, and device-id that
 * third-party packages like @xct007/tiktok-scraper rely on.
 */

const axios = require('axios');
const { JSDOM } = require('jsdom');

const WEB_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

const API_BASE = 'https://api22-normal-c-alisg.tiktokv.com';
const API_HEADERS = {
    'User-Agent': 'okhttp/3.14.9',
    'Accept-Encoding': 'gzip',
    Connection: 'close',
};

function randomDeviceId() {
    let id = '';
    for (let i = 0; i < 19; i++) id += Math.floor(Math.random() * 10);
    return id;
}

/**
 * Normalise a TikTok username: strip @, URL prefix, trailing junk.
 */
function normaliseUsername(input) {
    let name = String(input || '').trim();
    const urlMatch = name.match(/(?:tiktok\.com|vm\.tiktok\.com)\/(?:@)?([a-zA-Z0-9_.]+)/);
    if (urlMatch) return urlMatch[1];
    name = name.replace(/^@/, '');
    name = name.replace(/[^a-zA-Z0-9_.].*$/, '');
    return name || null;
}

/**
 * Phase 1 — Extract secUid + base identity from TikTok's web profile page.
 * Handles __UNIVERSAL_DATA_FOR_REHYDRATION__ (current SSR),
 * __NEXT_DATA__ and SIGI_STATE (legacy payloads).
 */
async function resolveUsername(username) {
    const name = normaliseUsername(username);
    if (!name) return { ok: false, error: 'invalid_username' };

    try {
        const res = await axios.get(`https://www.tiktok.com/@${name}`, {
            headers: WEB_HEADERS,
            timeout: 15000,
        });

        const html = res.data;

        function extractUser(json) {
            return (
                json?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user ||
                json?.props?.pageProps?.userData?.user ||
                json?.props?.pageProps?.userInfo?.user ||
                json?.props?.pageProps?.user ||
                null
            );
        }

        function buildResult(user) {
            return {
                ok: true,
                secUid: user.secUid,
                userId: user.id || user.uid,
                uniqueId: user.uniqueId || name,
                nickname: user.nickname,
                signature: user.signature,
                avatar: user.avatarLarger || user.avatarMedium || user.avatarThumb,
                verified: !!user.verified,
                private: !!user.privateAccount,
                followerCount: user.followerCount,
                followingCount: user.followingCount,
                heartCount: user.heartCount || user.totalFavorited,
                videoCount: user.videoCount || user.awemeCount,
            };
        }

        // 1. __UNIVERSAL_DATA_FOR_REHYDRATION__ (current TikTok SSR)
        const uniMatch = html.match(
            /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
        );
        if (uniMatch) {
            try {
                const json = JSON.parse(uniMatch[1]);
                const user = extractUser(json);
                if (user?.secUid) return buildResult(user);
            } catch {
                // fall through
            }
        }

        // 2. __NEXT_DATA__ (legacy Next.js)
        const nextMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (nextMatch) {
            try {
                const json = JSON.parse(nextMatch[1]);
                const user = extractUser(json);
                if (user?.secUid) return buildResult(user);
            } catch {
                // fall through
            }
        }

        // 3. SIGI_STATE (legacy SPA)
        const sigiMatch = html.match(/<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
        if (sigiMatch) {
            try {
                const json = JSON.parse(sigiMatch[1]);
                const uid = Object.keys(json?.UserModule?.users || {})[0];
                const user = uid ? json.UserModule.users[uid] : null;
                if (user?.secUid) return buildResult(user);
            } catch {
                // fall through
            }
        }

        // 4. Meta tag fallback
        try {
            const dom = new JSDOM(html);
            const metaUser = dom.window.document
                .querySelector('meta[name="user-info"]')
                ?.content?.trim();
            if (metaUser) {
                const parsed = JSON.parse(metaUser);
                if (parsed?.secUid) {
                    return {
                        ok: true,
                        secUid: parsed.secUid,
                        userId: parsed.userId,
                        uniqueId: name,
                    };
                }
            }
        } catch {
            // give up
        }

        return { ok: false, error: 'secUid_not_found' };
    } catch (err) {
        if (err.response?.status === 404) {
            return { ok: false, error: 'user_not_found' };
        }
        return { ok: false, error: `fetch_failed:${err.message}` };
    }
}

/**
 * Phase 2 — Fetch full profile stats from TikTok internal API.
 * Requires secUid obtained from resolveUsername().
 */
async function fetchProfile(secUid, options = {}) {
    if (!secUid) return { ok: false, error: 'secUid_required' };

    const count = options.count || 35;
    const cursor = options.cursor || 0;

    try {
        const deviceId = randomDeviceId();
        const url = `${API_BASE}/aweme/v1/user/profile/other/?device_id=${deviceId}&version_code=34.0.0&language=en&app_name=musically_go&channel=googleplay&build_number=34.0.0&aid=1233&os=android&iid=${randomDeviceId()}`;

        const { data } = await axios.post(
            url,
            { user_id: secUid, count, cursor },
            { headers: API_HEADERS, timeout: 15000 },
        );

        if (data.status_code === 0 && data.user) {
            const u = data.user;
            return {
                ok: true,
                profile: {
                    uniqueId: u.uniqueId,
                    nickname: u.nickname,
                    signature: u.signature,
                    avatar: u.avatarLarger || u.avatarMedium || u.avatarThumb,
                    verified: !!u.verified,
                    private: !!u.privateAccount,
                    followerCount: u.followerCount || u.follower_count || 0,
                    followingCount: u.followingCount || u.following_count || 0,
                    heartCount: u.heartCount || u.total_favorited || u.heart || 0,
                    videoCount: u.videoCount || u.awemeCount,
                    region: u.region,
                    language: u.language,
                    duetSetting: u.duetSetting,
                    stitchSetting: u.stitchSetting,
                    commentSetting: u.commentSetting,
                    openFavorite: u.openFavorite,
                    isUnderAge18: u.isUnderAge18,
                    secUid: u.secUid,
                    userId: u.id || u.uid,
                },
                raw: u,
            };
        }

        return {
            ok: false,
            error: `api_error:${data.status_code}`,
            raw: data,
        };
    } catch (err) {
        return { ok: false, error: `fetch_failed:${err.message}` };
    }
}

/**
 * Phase 3 — Fetch video posts from TikTok internal API.
 * Requires secUid obtained from resolveUsername().
 */
async function fetchPosts(secUid, options = {}) {
    if (!secUid) return { ok: false, error: 'secUid_required' };

    const count = options.count || 20;
    const cursor = options.cursor || 0;

    try {
        const deviceId = randomDeviceId();
        const url = `${API_BASE}/aweme/v1/aweme/post/?device_id=${deviceId}&version_code=34.0.0&language=en&app_name=musically_go&channel=googleplay&build_number=34.0.0&aid=1233&os=android&iid=${randomDeviceId()}`;

        const { data } = await axios.post(
            url,
            { user_id: secUid, count, cursor, pull_type: 2 },
            { headers: API_HEADERS, timeout: 15000 },
        );

        if (data.status_code === 0 && Array.isArray(data.aweme_list)) {
            const videos = data.aweme_list.map((item) => {
                const video = item.video || {};
                const author = item.author || {};
                const stats = item.statistics || {};

                const playUrl =
                    video.play_addr?.url_list?.[0] ||
                    video.play_addr?.url_list?.[1] ||
                    video.download_addr?.url_list?.[0] ||
                    null;

                return {
                    id: item.aweme_id,
                    desc: item.desc || '',
                    createTime: item.create_time,
                    duration: item.duration,
                    videoUrl: playUrl,
                    cover: video.cover?.url_list?.[0] || video.origin_cover?.url_list?.[0] || null,
                    width: video.width,
                    height: video.height,
                    author: {
                        uid: author.uid,
                        uniqueId: author.uniqueId,
                        nickname: author.nickname,
                        avatar: author.avatarLarger || author.avatarMedium || author.avatarThumb,
                    },
                    stats: {
                        playCount: stats.play_count || 0,
                        likeCount: stats.digg_count || 0,
                        commentCount: stats.comment_count || 0,
                        shareCount: stats.share_count || 0,
                    },
                };
            });

            return {
                ok: true,
                videos,
                hasMore: data.has_more === 1,
                cursor: data.cursor || cursor + count,
            };
        }

        return {
            ok: false,
            error: `api_error:${data.status_code}`,
            raw: data,
        };
    } catch (err) {
        return { ok: false, error: `fetch_failed:${err.message}` };
    }
}

/**
 * Phase 1+2+3 convenience — resolve a username then fetch profile + posts.
 */
async function getProfileWithPosts(username, options = {}) {
    const resolved = await resolveUsername(username);
    if (!resolved.ok) return resolved;

    const [profileResult, postsResult] = await Promise.all([
        fetchProfile(resolved.secUid, options),
        fetchPosts(resolved.secUid, options),
    ]);

    return {
        ok: profileResult.ok || postsResult.ok,
        profile: {
            ...resolved,
            ...(profileResult.ok ? profileResult.profile : {}),
        },
        videos: postsResult.ok ? postsResult.videos : [],
        errors: {
            profile: profileResult.ok ? null : profileResult.error,
            posts: postsResult.ok ? null : postsResult.error,
        },
    };
}

/**
 * Simple alias: resolve username only (no API calls).
 */
async function getProfile(username) {
    return resolveUsername(username);
}

module.exports = {
    normaliseUsername,
    resolveUsername,
    fetchProfile,
    fetchPosts,
    getProfileWithPosts,
    getProfile,
};
