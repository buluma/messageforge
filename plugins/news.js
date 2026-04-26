'use strict';
const axios = require('axios');

const FEEDS = {
    world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    tech: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    africa: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml',
    business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    sports: 'https://feeds.bbci.co.uk/sport/rss.xml',
};

function stripHtml(input) {
    return String(input || '')
        .replace(/<!\[CDATA\[(.*?)\]\]>/gis, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function decodeXml(input) {
    return String(input || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function pickTag(block, tag) {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return m ? decodeXml(stripHtml(m[1])) : '';
}

function parseRssItems(xml, limit = 5) {
    const items = [];
    const re = /<item\b[\s\S]*?<\/item>/gi;
    let match;
    while ((match = re.exec(xml)) && items.length < limit) {
        const block = match[0];
        const title = pickTag(block, 'title');
        const link = pickTag(block, 'link');
        const pubDate = pickTag(block, 'pubDate');
        if (!title || !link) continue;
        items.push({ title, link, pubDate });
    }
    return items;
}

function fmtDate(input) {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleString();
}

module.exports = {
    commands: ['news', 'headlines'],
    description: 'Get latest news headlines',
    permission: 'public',
    group: true,
    private: true,
    run: async (sock, message, args, { sender, groupId, contextInfo }) => {
        const chatId = groupId || sender;
        const category = (args[0] || 'world').toLowerCase();
        const feedUrl = FEEDS[category] || FEEDS.world;
        try {
            const { data: xml } = await axios.get(feedUrl, {
                timeout: 12000,
                responseType: 'text',
                headers: { 'User-Agent': 'silva-md-bot-news/1.0' },
            });
            const items = parseRssItems(xml, 5);
            if (!items?.length) throw new Error('No news found.');
            const lines = items
                .map(
                    (item, i) =>
                        `${i + 1}. *${item.title}*\n   🕒 ${fmtDate(item.pubDate)}\n   🔗 ${item.link}`,
                )
                .join('\n\n');
            const cats = Object.keys(FEEDS).join(' | ');
            await sock.sendMessage(
                chatId,
                {
                    text: `📰 *Latest News — ${category.toUpperCase()}*\n\n${lines}\n\n_Categories: ${cats}_\n_Powered by BBC • ShadowBot_`,
                    contextInfo,
                },
                { quoted: message },
            );
        } catch (e) {
            await sock.sendMessage(
                chatId,
                { text: `❌ News fetch failed: ${e.message}`, contextInfo },
                { quoted: message },
            );
        }
    },
};
