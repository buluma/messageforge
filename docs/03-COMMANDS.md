# 📋 Full Command Reference

MessageForge features **1000+ commands** across 175+ specialized plugins. Use your prefix (default `.`) followed by the command name.

## 📑 Table of Contents

- [Usage & Syntax](#-usage--syntax)
- [Downloaders](#-downloaders)
- [Music & Audio](#-music--audio)
- [AI & Intelligence](#-ai--intelligence)
- [Search & Info](#-search--info)
- [Media Tools](#-media-tools)
- [Group Management](#-group-management)
- [Welcome & Events](#-welcome--events)
- [Protection](#-protection)
- [Fun & Entertainment](#-fun--entertainment)
- [Privacy & Utilities](#-privacy--utilities)
- [Status & Profile](#-status--profile)
- [Channels](#-channels)
- [Bot Info](#-bot-info)
- [Owner & Sudo](#-owner--sudo)
- [Games](#-games)
- [Text & Dev Tools](#-text--dev-tools)
- [Crypto & Finance](#-crypto--finance)
- [Health & Fitness](#-health--fitness)
- [Education](#-education)
- [Productivity](#-productivity)
- [Leveling & XP](#-leveling--xp)
- [Link Tools](#-link-tools)
- [Voice Tools](#-voice-tools)
- [Permission Levels](#-permission-levels)

---

## 📖 Usage & Syntax

```
<prefix><command> [arguments]
```

| Element | Description |
|---------|-------------|
| `.` | Default prefix (configurable with `.setprefix`) |
| `command` | The command name |
| `[args]` | Optional arguments (varies by command) |
| `@user` | Mention a user by @tagging |
| `reply` | Reply to a message to use it as context |

**Examples:**
```
.yt never gonna give you up
.play despacito
.kick @spammer
.wiki artificial intelligence
.calc 15 * 23 + 7
```

---

## ⬇️ Downloaders

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.yt` | `.youtube` | Download YouTube videos | `.yt <search or URL>` |
| `.tiktok` | `.tt` | Download TikTok videos (no watermark) | `.tiktok <url>` |
| `.instagram` | `.ig` | Download Instagram content | `.instagram <url>` |
| `.facebook` | `.fb` | Download Facebook videos | `.facebook <url>` |
| `.apk` | `.apkdl` | Download APK from APKPure | `.apk <app name>` |
| `.catbox` | | Upload media to catbox hosting | Reply to image/video |

---

## 🎵 Music & Audio

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.play` | `.music` | Search and download YouTube audio | `.play <song>` |
| `.shazam` | | Identify song from audio clip | Reply to audio |
| `.lyrics` | | Fetch song lyrics | `.lyrics <song name>` |
| `.toaudio` | | Convert video to audio | Reply to video |
| `.spotify` | | Search Spotify info | `.spotify <track>` |
| `.soundcloud` | | Search SoundCloud | `.soundcloud <query>` |

---

## 🤖 AI & Intelligence

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.ai` | `.gpt`, `.chat` | Chat with AI assistant | `.ai <question>` |
| `.agent` | | Advanced AI agent mode | `.agent <task>` |
| `.ask` | | Quick question to AI | `.ask <question>` |
| `.messageforge` | | Natural language commands | `.messageforge <request>` |
| `.assistant` | | Full AI assistant | `.assistant <prompt>` |
| `.imagine` | | Generate AI images | `.imagine <description>` |
| `.translate` | `.tr` | Translate text | `.tr <text> [to lang]` |
| `.define` | | Dictionary lookup | `.define <word>` |
| `.tts` | | Text-to-speech | `.tts <text>` |
| `.calc` | | Calculator | `.calc <expression>` |
| `.shorten` | | Shorten URLs | `.shorten <url>` |
| `.gitclone` | | Clone GitHub repos | `.gitclone <repo URL>` |
| `.anime` | | Search anime info | `.anime <name>` |
| `.manga` | | Search manga info | `.manga <name>` |

---

## 🌍 Search & Info

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.wiki` | `.wikipedia` | Wikipedia search | `.wiki <topic>` |
| `.country` | | Country information | `.country <name>` |
| `.ip` | `.ipinfo` | IP address lookup | `.ip <address>` |
| `.currency` | | Currency info | `.currency <code>` |
| `.time` | | Current time | `.time [timezone]` |
| `.weather` | | Weather report | `.weather <city>` |
| `.numberfact` | | Random number facts | `.numberfact [number]` |
| `.news` | | Latest news | `.news [topic]` |
| `.reddit` | | Search Reddit | `.reddit <query>` |
| `.spotify` | | Spotify search | `.spotify <track/artist>` |

---

## 🖼️ Media Tools

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.vv` | `.viewonce` | Reveal view-once media | Reply to vv image/video |
| `.ascii` | | Create ASCII art | `.ascii <text>` |
| `.qrcode` | `.qr` | Generate QR code | `.qrcode <text or url>` |
| `.react` | | Add reaction | `.react <emoji>` |
| `.toimg` | | Sticker to image | Reply to sticker |
| `.tojpeg` | | Convert to JPEG | Reply to image |
| `.togif` | | Convert to GIF | Reply to image/sticker |
| `.carbon` | | Code screenshot | `.carbon <code>` |
| `.color` | | Color palette from image | Reply to image |
| `.ocr` | | Extract text from image | Reply to image |
| `.screenshot` | | Website screenshot | `.screenshot <url>` |

---

## 👥 Group Management

| Command | Aliases | Description | Permission |
|---------|---------|-------------|------------|
| `.kick` | `.remove` | Remove user from group | Admin |
| `.promote` | `.admin` | Make user admin | Admin |
| `.demote` | | Remove admin status | Admin |
| `.ban` | | Ban user from group | Admin |
| `.unban` | | Unban user | Admin |
| `.banlist` | | List banned users | Admin |
| `.tagall` | | Mention all members | Admin |
| `.hidetag` | | Silent mention all | Admin |
| `.poll` | | Create poll | Admin |
| `.lock` | | Only admins can msg | Admin |
| `.unlock` | | Everyone can msg | Admin |
| `.link` | `.grouplink` | Get group invite link | Admin |
| `.revoke` | | Reset group link | Admin |
| `.setname` | | Change group name | Admin |
| `.setdesc` | | Change group description | Admin |
| `.broadcast` | | Broadcast to group | Admin |
| `.mutemember` | | Mute specific member | Admin |
| `.warn` | | Warn a user | Admin |
| `.clearwarn` | | Clear warnings | Admin |
| `.setgroup` | | Group settings | Admin |

---

## 👋 Welcome & Events

| Command | Aliases | Description | Permission |
|---------|---------|-------------|------------|
| `.welcome` | | Enable/disable welcome | Admin |
| `.goodbye` | | Enable/disable goodbye | Admin |
| `.setwelcome` | | Set welcome message | Admin |
| `.setgoodbye` | | Set goodbye message | Admin |
| `.welcomequiz` | | Welcome quiz on join | Admin |
| `.setquiz` | | Set quiz question | Admin |
| `.greet` | | Test welcome message | Admin |
| `.autoreply` | | Set auto-reply rules | Admin |
| `.awaymsg` | | Set away message | User |

---

## 🛡️ Protection

| Command | Aliases | Description | Permission |
|---------|---------|-------------|------------|
| `.antidemote` | | Prevent admin demotions | Admin |
| `.antidelete` | | Restore deleted messages | Admin |
| `.antilink` | | Delete link messages | Admin |
| `.anticall` | | Auto-reject calls | Owner |
| `.antivv` | | Auto-view view-once | Owner |
| `.autoread` | | Auto-read messages | Owner |
| `.blocklist` | | View blocked users | Owner |
| `.afk` | | Set AFK mode | User |
| `.auditlog` | | View moderation log | Admin |
| `.antibad` | | Anti-badwords filter | Admin |
| `.antibadwords` | | Configure word filter | Admin |
| `.antifake` | | Filter fake numbers | Admin |
| `.antiflood` | | Anti-spam flood | Admin |
| `.antigm` | | Anti-group-mention | Admin |
| `.antispam` | | Anti-spam detection | Admin |

---

## 😄 Fun & Entertainment

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.joke` | | Random joke | `.joke` |
| `.fact` | | Random fun fact | `.fact` |
| `.riddle` | | Brain teaser | `.riddle` |
| `.meme` | | Random meme | `.meme` |
| `.quote` | | Inspirational quote | `.quote` |
| `.advice` | | Random advice | `.advice` |
| `.compliment` | | Get a compliment | `.compliment` |
| `.flip` | | Flip a coin | `.flip` |
| `.bible` | | Bible verse | `.bible [verse]` |
| `.hello` | | Fun greeting | `.hello` |
| `.emojimix` | | Mix two emojis | `.emojimix 🧡💙` |
| `.pickup` | | Pickup lines | `.pickup` |
| `.horoscope` | | Daily horoscope | `.horoscope <sign>` |
| `.zodiac` | | Zodiac info | `.zodiac <sign>` |

---

## 🔒 Privacy & Utilities

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.password` | `.passgen` | Generate secure password | `.password [length]` |
| `.morse` | | Encode/decode morse | `.morse <text>` |
| `.base64` | | Base64 encode/decode | `.base64 <text>` |
| `.tempmail` | | Generate temp email | `.tempmail` |
| `.virus` | | Fake virus prank | Reply to user |
| `.eval` | | Execute JS (owner) | `.eval <code>` |
| `.pastebin` | | Create paste | `.pastebin <text>` |
| `.whois` | | WhatsApp user info | Reply or @user |
| `.getpp` | | Get profile picture | @user or number |
| `.readreceipt` | | Toggle read receipts | `.readreceipt` |
| `.presence` | | Set online status | `.presence [available]` |
| `.setbio` | | Set your bio | `.setbio <text>` |
| `.setstatus` | | Set status | `.setstatus <text>` |

---

## 📊 Status & Profile

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.save` | `.spp` | Save status | Reply to image/video |
| `.autostatus` | | Auto-view statuses | Owner toggle |
| `.autojoin` | | Auto-join invited groups | Owner toggle |
| `.analytics` | | Chat analytics | `.analytics` |
| `.topusers` | | Most active users | `.topusers` |
| `.peakhours` | | Peak activity hours | `.peakhours` |
| `.profile` | | Your profile | `.profile [@user]` |
| `.vcf` | | Generate vCard | `.vcf [@user]` |
| `.bookmark` | | Bookmark message | Reply to message |
| `.bookmarks` | | View bookmarks | `.bookmarks` |
| `.favorites` | | Favorite chats | `.favorites` |

---

## 📰 Channels

| Command | Aliases | Description | Permission |
|---------|---------|-------------|------------|
| `.newsletter` | | Newsletter management | Admin |
| `.followchannel` | | Follow a channel | User |
| `.unfollowchannel` | | Unfollow channel | User |
| `.channelinfo` | | Channel information | User |
| `.statussave` | | Save status to inbox | User |
| `.status` | | Post as status | User |

---

## ℹ️ Bot Info

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.alive` | `.bot` | Check bot status | `.alive` |
| `.ping` | | Response time | `.ping` |
| `.uptime` | | Bot uptime | `.uptime` |
| `.owner` | | Bot owner info | `.owner` |
| `.getjid` | | Get chat JID | `.getjid` |
| `.repo` | | GitHub repository | `.repo` |
| `.remind` | | Set reminder | `.remind <time> <msg>` |
| `.rremind` | | Remove reminder | `.rremind <id>` |
| `.myreminders` | | List your reminders | `.myreminders` |
| `.botinfo` | | Detailed bot info | `.botinfo` |

---

## 👑 Owner & Sudo

| Command | Aliases | Description | Permission |
|---------|---------|-------------|------------|
| `.sudo` | | Execute as sudo | Sudo |
| `.setsudo` | | Add sudo user | Owner |
| `.delsudo` | | Remove sudo | Owner |
| `.getsudo` | | List sudo users | Owner |
| `.resetsudo` | | Clear all sudo | Owner |
| `.block` | | Block user | Owner |
| `.unblock` | | Unblock user | Owner |
| `.setmode` | | Set bot mode | Owner |
| `.setprefix` | | Change prefix | Owner |
| `.setbotname` | | Set bot name | Owner |
| `.join` | | Join group via link | Owner |
| `.cmd` | | Run hidden command | Owner |
| `.restart` | | Restart bot | Owner |
| `.shutdown` | | Stop bot | Owner |
| `.backupgroup` | | Backup group data | Owner |
| `.restoregroup` | | Restore group data | Owner |
| `.broadcast` | | Broadcast to all | Owner |
| `.dmall` | | DM all users | Owner |
| `.settheme` | | Change bot theme | Owner |
| `.settings` | | Open settings panel | Owner |

---

## 🎮 Games

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.rps` | | Rock paper scissors | `.rps [rock\|paper\|scissors]` |
| `.hangman` | | Hangman word game | `.hangman` |
| `.ttt` | | Tic-tac-toe | `.ttt [@user]` |
| `.trivia` | | Trivia quiz | `.trivia` |
| `.riddle` | | Solve riddles | `.riddle` |
| `.slots` | | Slot machine | `.slots` |
| `.8ball` | | Magic 8-ball | `.8ball <question>` |
| `.scramble` | | Word scramble | `.scramble` |
| `.flagquiz` | | Guess the flag | `.flagquiz` |
| `.mathquiz` | | Math challenge | `.mathquiz` |
| `.wordchain` | | Word chain game | `.wordchain` |
| `.emojiguess` | | Emoji quiz | `.emojiguess` |
| `.challenge` | | Daily challenge | `.challenge` |
| `.dailychallenge` | | Get daily challenge | `.dailychallenge` |
| `.numberguess` | | Number guessing | `.numberguess` |
| `.wordgame` | | Word games | `.wordgame` |
| `.quote2` | | Random quote | `.quote2` |
| `.riddles` | | Multiple riddles | `.riddles` |
| `.wod` | | Word of the day | `.wod` |

---

## 🔧 Text & Dev Tools

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.reverse` | | Reverse text | `.reverse <text>` |
| `.upper` | | UPPERCASE text | `.upper <text>` |
| `.lower` | | lowercase text | `.lower <text>` |
| `.mock` | | MoCkInG tExT | `.mock <text>` |
| `.binary` | | Text to binary | `.binary <text>` |
| `.rot13` | | ROT13 cipher | `.rot13 <text>` |
| `.leet` | | 1337 speak | `.leet <text>` |
| `.json` | | Format JSON | `.json <json>` |
| `.urlencode` | | URL encode | `.urlencode <text>` |
| `.hash` | `.md5`, `.sha256` | Hash text | `.hash <text>` |
| `.timestamp` | `.epoch` | Unix timestamps | `.timestamp [ts]` |
| `.regex` | | Test regex | `.regex <pattern> <text>` |
| `.httpcode` | | HTTP status codes | `.httpcode [code]` |
| `.password` | `.passgen` | Password generator | `.password [len]` |
| `.cron` | | Cron expression help | `.cron` |
| `.chmod` | | Unix permissions | `.chmod <number>` |
| `.wordcount` | `.wc` | Count words/chars | `.wc <text>` |
| `.ascii2` | | ASCII character codes | `.ascii2 <text>` |
| `.ipinfo` | | IP lookup | `.ipinfo <ip>` |
| `.useragent` | `.ua` | Random user agent | `.ua` |
| `.color2` | | Color info | `.color2 <name>` |
| `.encode` | | Various encodings | `.encode <text>` |

---

## 💰 Crypto & Finance

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.crypto` | `.bitcoin` | Crypto info | `.crypto [symbol]` |
| `.loan` | | Loan calculator | `.loan <amt> <rate%> <yrs>` |
| `.savings` | | Savings calculator | `.savings <monthly> <rate%>` |
| `.tax` | | Tax calculator | `.tax <income> [rate%]` |
| `.inflation` | | Inflation calc | `.inflation <amt> <rate%> <yrs>` |
| `.billsplit` | `.split` | Split bill | `.split <total> <people>` |
| `.salary` | | Salary breakdown | `.salary <annual>` |
| `.discount` | | Discount calc | `.discount <price> <%>` |
| `.budget` | | Budget planner | `.budget` |
| `.expense` | | Track expenses | `.expense <amount>` |
| `.balances` | | View balances | `.balances` |
| `.invest` | | Investment tips | `.invest` |
| `.compound` | | Compound interest | `.compound <p> <r%> <t>` |
| `.networth` | | Net worth calc | `.networth <assets> <debts>` |
| `.tip` | | Tip calculator | `.tip <bill> [%]` |
| `.forex` | | Currency exchange | `.forex <from> <to>` |

---

## 💪 Health & Fitness

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.workout` | `.exercise` | Random workout | `.workout` |
| `.stretching` | `.stretch` | Stretching routine | `.stretch` |
| `.calories` | | Food calories | `.calories <food>` |
| `.water` | | Water intake calc | `.water <weight_kg>` |
| `.sleep` | | Sleep calculator | `.sleep [wake_time]` |
| `.meditation` | `.breathe` | Breathing exercise | `.meditate` |
| `.steps` | | Steps to distance | `.steps <number>` |
| `.yoga` | | Random yoga pose | `.yoga` |
| `.bmi` | | BMI calculator | `.bmi <kg> <cm>` |
| `.bodyfat` | `.bfp` | Body fat % | `.bodyfat <waist> <neck> <height>` |
| `.heartrate` | | Target heart rate | `.heartrate <age>` |
| `.recipe` | | Quick recipes | `.recipe` |
| `.calorie` | | Calorie lookup | `.calorie <food>` |

---

## 📚 Education

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.element` | `.chem` | Periodic table | `.element <symbol>` |
| `.planet` | | Planet info | `.planet <name>` |
| `.zodiac` | `.horoscope` | Zodiac signs | `.zodiac <sign>` |
| `.vocab` | `.wotd` | Word of the day | `.vocab` |
| `.acronym` | | Abbreviation lookup | `.acronym <abbr>` |
| `.flag` | | Country flags | `.flag <country>` |
| `.nato` | `.phonetic` | NATO alphabet | `.nato <text>` |
| `.country` | | Country info | `.country <name>` |
| `.phrasebook` | `.swahili` | Swahili phrases | `.phrasebook` |
| `.spell` | | Spell a word | `.spell <word>` |
| `.typing` | `.wpm` | Typing test | `.typing` |
| `.currency` | | Currency info | `.currency <code>` |
| `.quote2` | | Quotes by category | `.quote2 [category]` |
| `.vocabulary` | | English vocab | `.vocabulary` |
| `.quote` | | Inspirational quotes | `.quote` |

---

## 📝 Productivity

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.pomodoro` | | Pomodoro timer | `.pomodoro [minutes]` |
| `.habits` | | Habit tracker | `.habits` |
| `.goals` | | Goal setter | `.goals` |
| `.journal` | | Daily journal | `.journal <entry>` |
| `.flashcards` | | Study flashcards | `.flashcards` |
| `.bookmarks` | | Saved bookmarks | `.bookmarks` |
| `.schedule` | | Schedule message | `.schedule <time> <msg>` |
| `.todo` | | Todo list | `.todo <task>` |
| `.notes` | | Quick notes | `.notes` |
| `.timer` | | Countdown timer | `.timer <seconds>` |
| `.remind` | | Set reminder | `.remind <time> <msg>` |
| `.recurring` | | Recurring reminders | `.recurring <cron> <msg>` |
| `.autoreply` | | Auto-reply rules | `.autoreply` |
| `.awaymsg` | | Away message | `.awaymsg <text>` |
| `.expense` | | Track spending | `.expense <amount>` |
| `.splitbill` | | Split expenses | `.splitbill` |
| `.balances` | | View finances | `.balances` |
| `.notes` | | Personal notes | `.notes` |
| `.saved` | | View saved items | `.saved` |
| `.recurring-remind` | | Recurring reminders | `.recurring-remind` |

---

## 🏆 Leveling & XP

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.level` | | Check your level | `.level` |
| `.rank` | | Your rank | `.rank` |
| `.xp` | | View XP | `.xp` |
| `.leaderboard` | | Top users | `.leaderboard` |
| `.leveling` | | Leveling settings | Admin |
| `.addexpense` | | Add expense | `.addexpense <amt>` |
| `.clearexpenses` | | Clear expenses | Admin |
| `.myexpenses` | | View expenses | `.myexpenses` |

---

## 🔗 Link Tools

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.summarize` | `.tldr` | Summarize content | Reply to link/text |
| `.linkpreview` | | Preview link info | `.linkpreview <url>` |
| `.linksummary` | | Get link summary | Reply to link |
| `.url` | | URL info | `.url <url>` |
| `.shorten` | | Shorten URL | `.shorten <url>` |
| `.gdrive` | | Google Drive info | `.gdrive <link>` |

---

## 🎤 Voice Tools

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.transcribe` | | Audio to text | Reply to audio |
| `.voicetotext` | | Speech recognition | Reply to voice |
| `.tts` | | Text to speech | `.tts <text>` |
| `.capcut` | | Capcut template | `.capcut <query>` |
| `.mediafire` | | MediaFire download | `.mediafire <url>` |
| `.twitter` | `.x` | Twitter/X download | `.twitter <url>` |
| `.threads` | | Threads download | `.threads <url>` |
| `.pinterest` | | Pinterest download | `.pinterest <query>` |
| `.reddit` | | Reddit content | `.reddit <url>` |

---

## 📋 Math Tools

| Command | Aliases | Description | Usage |
|---------|---------|-------------|-------|
| `.sqrt` | `.squareroot` | Square root | `.sqrt <number>` |
| `.power` | `.pow` | Power/exponent | `.power <base> <exp>` |
| `.factorial` | `.fact` | Factorial | `.factorial <n>` |
| `.prime` | `.isprime` | Prime check | `.prime <n>` |
| `.fibonacci` | `.fib` | Fibonacci sequence | `.fib [count]` |
| `.random` | `.rand` | Random number | `.random [min] [max]` |
| `.average` | `.avg` | Calculate average | `.average <nums>` |
| `.median` | | Median value | `.median <nums>` |
| `.gcd` | | Greatest common divisor | `.gcd <a> <b>` |
| `.lcm` | | Least common multiple | `.lcm <a> <b>` |
| `.celsius` | | F to C conversion | `.celsius <F>` |
| `.fahrenheit` | | C to F conversion | `.fahrenheit <C>` |
| `.roman` | | To Roman numerals | `.roman <number>` |
| `.age` | `.agecalc` | Age calculator | `.age <birthdate>` |
| `.compound` | | Compound interest | `.compound <p> <r%> <t>` |
| `.convert` | | Unit converter | `.convert <val> <from> <to>` |
| `.hex2dec` | | Hex to decimal | `.hex2dec <hex>` |
| `.dec2hex` | | Decimal to hex | `.dec2hex <num>` |
| `.oct` | | To octal | `.oct <number>` |
| `.log` | | Logarithm | `.log <n> [base]` |
| `.pi` | | Pi digits | `.pi [count]` |
| `.abs` | | Absolute value | `.abs <number>` |
| `.round` | | Round number | `.round <n> [decimals]` |

---

## 🔑 Permission Levels

| Level | Description | Access |
|-------|-------------|--------|
| **public** | Everyone | Basic commands |
| **admin** | Group admins | Moderation, settings |
| **sudo** | Bot sudoers | Advanced controls |
| **owner** | Bot owner | Full system access |

---

## 💡 Tips

- **Aliases**: Most commands have shorter aliases (e.g., `.yt` for `.youtube`)
- **Reply**: Reply to a message to use it as context for many commands
- **@mention**: Use `@user` to target specific users
- **Help**: Type `.help <command>` for detailed usage
- **Menu**: Type `.menu` to see all available commands in your context

---

_For more commands, check `.menu` or contact the bot owner._
