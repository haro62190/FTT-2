# Graph Report - FTT-2  (2026-11-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1018 nodes · 2508 edges · 37 communities
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 301 edges (avg confidence: 0.85)
- Token cost: 45,836 input · 449 output

## Graph Freshness
- Built from commit: `b606ea0a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Birthday Announcements
- Guide Generation & Backups
- Bot Core & Audit Logging
- Invite & Permission Security
- Economy & Shop
- Live Stream Charts
- Custom Commands
- Admin Dashboard Routes
- Music Playback
- Admin Build Commands
- Web Dashboard Auth
- Live Quiz Games
- Gaming Team Matchmaking
- Tournament Brackets
- Package Dependencies
- Referrals & Member of Month
- Community Challenges
- Game Night Booking
- Server Stats History
- Daily Quests
- XP Boosts & Activity Feed
- Suggestions & Verification
- Health Monitoring
- Weekly Server Insights
- Support Tickets
- CI Test Workflow
- Levels & XP System
- Member Stats Leaderboards
- Command & Stability Tests
- Dev Runner Script
- Staff Applications
- Audit Event Logs
- Database Storage & Backups
- Member Reports
- Dashboard Tests
- Module Settings
- Update Script

## God Nodes (most connected - your core abstractions)
1. `save()` - 147 edges
2. `findChannel()` - 92 edges
3. `discord.js` - 56 edges
4. `db` - 54 edges
5. `findRole()` - 46 edges
6. `get()` - 39 edges
7. `BRAND_COLOR` - 31 edges
8. `on()` - 15 edges
9. `checkLive()` - 15 edges
10. `set()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `leaveForeignGuild()` --calls--> `findChannel()`  [EXTRACTED]
  src/bot.js → src/shared.js
- `sendLog()` --calls--> `findChannel()`  [EXTRACTED]
  src/bot.js → src/shared.js
- `'/giveaways'()` --calls--> `findChannel()`  [EXTRACTED]
  src/dashboard-pages.js → src/shared.js
- `'POST /evenements'()` --calls--> `findChannel()`  [EXTRACTED]
  src/dashboard-pages.js → src/shared.js
- `'POST /stats'()` --calls--> `save()`  [EXTRACTED]
  src/dashboard-pages.js → src/store.js

## Import Cycles
- None detected.

## Communities (37 total, 0 thin omitted)

### Community 0 - "Birthday Announcements"
Cohesion: 0.05
Nodes (62): check(), commands, done(), { EmbedBuilder, MessageFlags, SlashCommandBuilder }, isLeap(), MONTHS, parisNow(), start() (+54 more)

### Community 1 - "Guide Generation & Backups"
Cohesion: 0.05
Nodes (48): fs, out, path, offsiteBackup(), BRAND, FONT_DIR, fontFiles(), fs (+40 more)

### Community 2 - "Bot Core & Audit Logging"
Cohesion: 0.06
Nodes (47): describeOptions(), record(), client, { Client, GatewayIntentBits, Partials, EmbedBuilder, Events, MessageFlags }, ctx, INTERACTIVE, leaveForeignGuild(), sendLog() (+39 more)

### Community 3 - "Invite & Permission Security"
Cohesion: 0.06
Nodes (49): bitfield(), clientIdFromToken(), grantable(), inviteUrl(), missing(), { PermissionFlagsBits: P, PermissionsBitField }, REQUIRED, actions (+41 more)

### Community 4 - "Economy & Shop"
Cohesion: 0.08
Nodes (45): parisDate(), '/anniversaires'(), '/automod'(), '/communaute'(), '/economie'(), '/saisons'(), {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
}, add() (+37 more)

### Community 5 - "Live Stream Charts"
Cohesion: 0.08
Nodes (41): dataTable(), dateFr(), esc(), fmt(), INK, lineChart(), niceMax(), SERIES (+33 more)

### Community 6 - "Custom Commands"
Cohesion: 0.07
Nodes (36): {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
}, cleanName(), commands, commandsDb(), cooldown, deleteCommand(), deleteMenu(), ephemeral() (+28 more)

### Community 7 - "Admin Dashboard Routes"
Cohesion: 0.07
Nodes (28): '/copies-base'(), { execFileSync }, fs, '/notifications'(), path, { PermissionFlagsBits: P }, 'POST /copies-base'(), 'POST /notifications'() (+20 more)

### Community 8 - "Music Playback"
Cohesion: 0.08
Nodes (27): '/musique'(), {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
}, commands, createStream(), formatDuration(), getQueueFor(), GuildQueue, isMod() (+19 more)

### Community 9 - "Admin Build Commands"
Cohesion: 0.08
Nodes (29): discord.js, {
  ChannelType,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
}, commands, fs, path, runBuild(), SECURITY_PARAMS, {
  AutoModerationActionType: Action,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType: Preset,
  AutoModerationRuleTriggerType: Trigger,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
} (+21 more)

### Community 10 - "Web Dashboard Auth"
Cohesion: 0.09
Nodes (32): alertCount(), BASE, checkbox(), clientIp(), crypto, csrf(), esc(), exchangeCode() (+24 more)

### Community 11 - "Live Quiz Games"
Cohesion: 0.11
Nodes (29): {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
}, arm(), bar(), commands, ephemeral(), expire(), finishQuiz(), games() (+21 more)

### Community 12 - "Gaming Team Matchmaking"
Cohesion: 0.13
Nodes (30): {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
}, autocompleteGames(), AVAIL, availChoices, commands, createTeamVoices(), ephemeral(), findPlayers() (+22 more)

### Community 13 - "Tournament Brackets"
Cohesion: 0.17
Nodes (27): '/equipes'(), 'POST /tournois'(), '/tournois'(), save(), { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder }, advance(), all(), autocomplete() (+19 more)

### Community 14 - "Package Dependencies"
Cohesion: 0.09
Nodes (23): dependencies, discord.js@^14.28.1, @discordjs/voice@^0.19.2, dotenv@^16.4.5, @resvg/resvg-js@^2.6.2, description, engines, node (+15 more)

### Community 15 - "Referrals & Member of Month"
Cohesion: 0.16
Nodes (21): checkMonth(), checkReferrals(), commands, CRITERIA, currentMonth(), { EmbedBuilder, MessageFlags, SlashCommandBuilder }, month(), motmRanking() (+13 more)

### Community 16 - "Community Challenges"
Cohesion: 0.13
Nodes (17): active(), all(), commands, complete(), create(), dirty, { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder }, progress() (+9 more)

### Community 17 - "Game Night Booking"
Cohesion: 0.18
Nodes (18): 'POST /equipes'(), {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
}, all(), book(), cancel(), commands, ephemeral(), handleInteraction() (+10 more)

### Community 18 - "Server Stats History"
Cohesion: 0.17
Nodes (17): '/stats'(), bump(), day(), gauge(), today(), commands, discordCount(), { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } (+9 more)

### Community 19 - "Daily Quests"
Cohesion: 0.15
Nodes (15): '/modules'(), '/quetes-boost'(), announce(), commands, crypto, DAILY, def(), draw() (+7 more)

### Community 20 - "XP Boosts & Activity Feed"
Cohesion: 0.15
Nodes (12): active(), commands, { EmbedBuilder, PermissionFlagsBits: P, SlashCommandBuilder }, multiplier(), startBoost(), stopBoost(), member(), push() (+4 more)

### Community 21 - "Suggestions & Verification"
Cohesion: 0.20
Nodes (18): { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, PermissionFlagsBits: P }, challengePayload(), challenges, CHOICES, ephemeral(), handleInteraction(), isStaff(), onReaction() (+10 more)

### Community 22 - "Health Monitoring"
Cohesion: 0.12
Nodes (15): alert(), beat(), commands, { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder }, { execFileSync }, fs, HEARTBEAT, installErrorHandlers() (+7 more)

### Community 23 - "Weekly Server Insights"
Cohesion: 0.20
Nodes (16): bestSlots(), { ChannelType, EmbedBuilder }, check(), DAYS, parisParts(), postWeekly(), start(), suggestions() (+8 more)

### Community 24 - "Support Tickets"
Cohesion: 0.22
Nodes (16): ACCESS, {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
}, closeById(), closedRecently, closeTicket(), commands, controls(), done() (+8 more)

### Community 25 - "CI Test Workflow"
Cohesion: 0.13
Nodes (14): jobs, tests, name, on, pull_request, push, run, uses (+6 more)

### Community 26 - "Levels & XP System"
Cohesion: 0.25
Nodes (13): addXp(), applyRewards(), gradeDailyBonus(), lastGain, leaderboard(), levelInfo(), onMessage(), rankOf() (+5 more)

### Community 27 - "Member Stats Leaderboards"
Cohesion: 0.19
Nodes (10): findMember(), '/membres'(), 'POST /quetes-boost'(), board(), BOARDS, bump(), commands, { EmbedBuilder, SlashCommandBuilder } (+2 more)

### Community 28 - "Command & Stability Tests"
Cohesion: 0.17
Nodes (7): assert, test, assert, { execFileSync }, fs, path, test

### Community 29 - "Dev Runner Script"
Cohesion: 0.26
Nodes (12): checkGitHub(), fs, path, restartBot(), ROOT, run(), say(), { spawn, spawnSync } (+4 more)

### Community 30 - "Staff Applications"
Cohesion: 0.26
Nodes (12): {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
}, all(), canApply(), card(), commands, decide(), ephemeral(), handleInteraction() (+4 more)

### Community 31 - "Audit Event Logs"
Cohesion: 0.31
Nodes (12): { AuditLogEvent: A, EmbedBuilder, Events }, COLORS, log(), onAuditEntry(), onMessageUpdate(), onVoiceState(), reason(), register() (+4 more)

### Community 32 - "Database Storage & Backups"
Cohesion: 0.21
Nodes (11): brandBot(), db, DB_FILE, flush(), fs, latestVerifiedBackup(), legacy, moveAside() (+3 more)

### Community 33 - "Member Reports"
Cohesion: 0.24
Nodes (11): { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder }, card(), commands, DM, ephemeral(), handleInteraction(), pendingCount(), setStatus() (+3 more)

### Community 34 - "Dashboard Tests"
Cohesion: 0.18
Nodes (8): assert, { Collection, ChannelType, PermissionsBitField }, file, fs, m, Module, path, test

### Community 35 - "Module Settings"
Cohesion: 0.29
Nodes (9): counts(), all(), DEFAULTS, invalidate(), isObj(), merge(), MODULES, replaceAll() (+1 more)

### Community 36 - "Update Script"
Cohesion: 0.83
Nodes (3): healthy(), log(), update.sh script

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `discord.js` connect `Admin Build Commands` to `Birthday Announcements`, `Guide Generation & Backups`, `Bot Core & Audit Logging`, `Invite & Permission Security`, `Economy & Shop`, `Live Stream Charts`, `Custom Commands`, `Admin Dashboard Routes`, `Music Playback`, `Web Dashboard Auth`, `Live Quiz Games`, `Gaming Team Matchmaking`, `Tournament Brackets`, `Package Dependencies`, `Referrals & Member of Month`, `Community Challenges`, `Game Night Booking`, `Server Stats History`, `Daily Quests`, `XP Boosts & Activity Feed`, `Suggestions & Verification`, `Health Monitoring`, `Weekly Server Insights`, `Support Tickets`, `Member Stats Leaderboards`, `Staff Applications`, `Audit Event Logs`, `Member Reports`, `Dashboard Tests`?**
  _High betweenness centrality (0.164) - this node is a cross-community bridge._
- **Should `Birthday Announcements` be split into smaller, more focused modules?**
  _Cohesion score 0.0547945205479452 - nodes in this community are weakly interconnected._
- **Why does `save()` connect `Tournament Brackets` to `Birthday Announcements`, `Guide Generation & Backups`, `Bot Core & Audit Logging`, `Invite & Permission Security`, `Economy & Shop`, `Live Stream Charts`, `Custom Commands`, `Admin Dashboard Routes`, `Music Playback`, `Admin Build Commands`, `Web Dashboard Auth`, `Live Quiz Games`, `Gaming Team Matchmaking`, `Referrals & Member of Month`, `Community Challenges`, `Game Night Booking`, `Server Stats History`, `Daily Quests`, `XP Boosts & Activity Feed`, `Suggestions & Verification`, `Weekly Server Insights`, `Support Tickets`, `Levels & XP System`, `Member Stats Leaderboards`, `Staff Applications`, `Database Storage & Backups`, `Member Reports`, `Module Settings`?**
  _High betweenness centrality (0.160) - this node is a cross-community bridge._
- **Should `Guide Generation & Backups` be split into smaller, more focused modules?**
  _Cohesion score 0.05191256830601093 - nodes in this community are weakly interconnected._
- **Why does `findChannel()` connect `Birthday Announcements` to `Guide Generation & Backups`, `Bot Core & Audit Logging`, `Invite & Permission Security`, `Economy & Shop`, `Live Stream Charts`, `Custom Commands`, `Admin Dashboard Routes`, `Music Playback`, `Admin Build Commands`, `Web Dashboard Auth`, `Live Quiz Games`, `Gaming Team Matchmaking`, `Tournament Brackets`, `Referrals & Member of Month`, `Community Challenges`, `Game Night Booking`, `Server Stats History`, `Daily Quests`, `XP Boosts & Activity Feed`, `Suggestions & Verification`, `Health Monitoring`, `Weekly Server Insights`, `Support Tickets`, `Levels & XP System`, `Staff Applications`, `Audit Event Logs`, `Member Reports`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Should `Bot Core & Audit Logging` be split into smaller, more focused modules?**
  _Cohesion score 0.05902980713033314 - nodes in this community are weakly interconnected._
- **Should `Invite & Permission Security` be split into smaller, more focused modules?**
  _Cohesion score 0.05909090909090909 - nodes in this community are weakly interconnected._