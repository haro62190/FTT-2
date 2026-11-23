# Graph Report - Kensei (FTT-2)  (2026-11-23)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 514 nodes · 1230 edges · 19 communities
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 132 edges (avg confidence: 0.85)
- Token cost: 44,624 input · 229 output

## Community Hubs (Navigation)
- Bot Core & Music
- Admin Commands
- SVG Chart Rendering
- Birthday Reminders
- Server Builder Setup
- Backups & Dashboard Pages
- Web Dashboard Auth
- Security & Anti-Raid
- Custom Commands
- Temporary Voice Channels
- Seasons & Community Settings
- Server Stats History
- Community Engagement Features
- Health Monitoring
- Support Tickets
- Giveaways
- Dev Runner Script
- Audit Logging
- Update Script

## God Nodes (most connected - your core abstractions)
1. `save()` - 73 edges
2. `findChannel()` - 53 edges
3. `findRole()` - 37 edges
4. `db` - 26 edges
5. `get()` - 24 edges
6. `close()` - 13 edges
7. `TwitchClient` - 11 edges
8. `handleInteraction()` - 11 edges
9. `refresh()` - 10 edges
10. `check()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `disableAutoMod()` --indirect_call--> `PREFIX()`  [INFERRED]
  src/automod.js → src/custom.js
- `handleInteraction()` --indirect_call--> `PREFIX()`  [INFERRED]
  src/tickets.js → src/custom.js
- `'/giveaways'()` --calls--> `findChannel()`  [EXTRACTED]
  src/dashboard-pages.js → src/shared.js
- `'POST /evenements'()` --calls--> `findChannel()`  [EXTRACTED]
  src/dashboard-pages.js → src/shared.js
- `'POST /stats'()` --calls--> `save()`  [EXTRACTED]
  src/dashboard-pages.js → src/store.js

## Import Cycles
- None detected.

## Communities (19 total, 0 thin omitted)

### Community 0 - "Bot Core & Music"
Cohesion: 0.05
Nodes (31): client, { Client, GatewayIntentBits, Partials, EmbedBuilder, Events, MessageFlags }, ctx, '/musique'(), {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
}, commands, createStream(), formatDuration() (+23 more)

### Community 1 - "Admin Commands"
Cohesion: 0.06
Nodes (37): {
  ChannelType,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
}, commands, fs, parisDate(), path, runBuild(), SECURITY_PARAMS, {
  AutoModerationActionType: Action,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType: Preset,
  AutoModerationRuleTriggerType: Trigger,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
} (+29 more)

### Community 2 - "SVG Chart Rendering"
Cohesion: 0.07
Nodes (37): dataTable(), dateFr(), esc(), fmt(), INK, lineChart(), niceMax(), SERIES (+29 more)

### Community 3 - "Birthday Reminders"
Cohesion: 0.08
Nodes (32): brandBot(), check(), commands, done(), { EmbedBuilder, MessageFlags, SlashCommandBuilder }, isLeap(), MONTHS, parisNow() (+24 more)

### Community 4 - "Server Builder Setup"
Cohesion: 0.11
Nodes (33): leaveForeignGuild(), sendLog(), buildAll(), buildOverwrites(), {
  ChannelType,
  PermissionFlagsBits: P,
  OverwriteType,
  GuildVerificationLevel,
  GuildExplicitContentFilter,
  GuildDefaultMessageNotifications,
  GuildSystemChannelFlags,
}, configureGuild(), ensureChannels(), ensureRoles() (+25 more)

### Community 5 - "Backups & Dashboard Pages"
Cohesion: 0.08
Nodes (20): offsiteBackup(), {
  ChannelType,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  PermissionFlagsBits: P,
}, findMember(), fs, '/giveaways'(), job, path, 'POST /anniversaires'() (+12 more)

### Community 6 - "Web Dashboard Auth"
Cohesion: 0.11
Nodes (25): BASE, checkbox(), crypto, csrf(), esc(), exchangeCode(), fmtDate(), http (+17 more)

### Community 7 - "Security & Anti-Raid"
Cohesion: 0.12
Nodes (27): actions, alert(), {
  AuditLogEvent: A,
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
}, commands, deletedChannels, deletedRoles, endLockdown(), ignoredChannels (+19 more)

### Community 8 - "Custom Commands"
Cohesion: 0.19
Nodes (21): {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
}, cleanName(), commands, commandsDb(), cooldown, deleteCommand(), deleteMenu(), ephemeral() (+13 more)

### Community 9 - "Temporary Voice Channels"
Cohesion: 0.22
Nodes (20): save(), {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits: P,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
}, allVoiceRoles(), buildOverwrites(), cleanup(), createFor(), ephemeral(), handleInteraction() (+12 more)

### Community 10 - "Seasons & Community Settings"
Cohesion: 0.19
Nodes (19): '/anniversaires'(), '/automod'(), '/communaute'(), '/economie'(), '/saisons'(), add(), check(), close() (+11 more)

### Community 11 - "Server Stats History"
Cohesion: 0.16
Nodes (17): '/stats'(), bump(), day(), gauge(), today(), commands, discordCount(), { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder } (+9 more)

### Community 12 - "Community Engagement Features"
Cohesion: 0.20
Nodes (18): { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, PermissionFlagsBits: P }, challengePayload(), challenges, CHOICES, ephemeral(), handleInteraction(), isStaff(), onReaction() (+10 more)

### Community 13 - "Health Monitoring"
Cohesion: 0.12
Nodes (14): alert(), beat(), commands, { EmbedBuilder, MessageFlags, PermissionFlagsBits: P, SlashCommandBuilder }, { execFileSync }, fs, HEARTBEAT, installErrorHandlers() (+6 more)

### Community 14 - "Support Tickets"
Cohesion: 0.23
Nodes (14): ACCESS, {
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
}, closedRecently, closeTicket(), commands, controls(), done(), ephemeral() (+6 more)

### Community 15 - "Giveaways"
Cohesion: 0.25
Nodes (12): 'POST /giveaways'(), {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits: P,
  SlashCommandBuilder,
}, commands, create(), end(), ephemeral(), handleInteraction(), parseDuration() (+4 more)

### Community 16 - "Dev Runner Script"
Cohesion: 0.26
Nodes (12): checkGitHub(), fs, path, restartBot(), ROOT, run(), say(), { spawn, spawnSync } (+4 more)

### Community 17 - "Audit Logging"
Cohesion: 0.31
Nodes (12): { AuditLogEvent: A, EmbedBuilder, Events }, COLORS, log(), onAuditEntry(), onMessageUpdate(), onVoiceState(), reason(), register() (+4 more)

### Community 18 - "Update Script"
Cohesion: 0.83
Nodes (3): healthy(), log(), update.sh script

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `save()` connect `Temporary Voice Channels` to `Bot Core & Music`, `Admin Commands`, `SVG Chart Rendering`, `Birthday Reminders`, `Server Builder Setup`, `Backups & Dashboard Pages`, `Web Dashboard Auth`, `Security & Anti-Raid`, `Custom Commands`, `Seasons & Community Settings`, `Server Stats History`, `Community Engagement Features`, `Support Tickets`, `Giveaways`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Should `Bot Core & Music` be split into smaller, more focused modules?**
  _Cohesion score 0.053410893707033315 - nodes in this community are weakly interconnected._
- **Why does `findChannel()` connect `Server Builder Setup` to `Bot Core & Music`, `Admin Commands`, `SVG Chart Rendering`, `Birthday Reminders`, `Backups & Dashboard Pages`, `Web Dashboard Auth`, `Security & Anti-Raid`, `Custom Commands`, `Temporary Voice Channels`, `Seasons & Community Settings`, `Server Stats History`, `Community Engagement Features`, `Health Monitoring`, `Support Tickets`, `Audit Logging`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Should `Admin Commands` be split into smaller, more focused modules?**
  _Cohesion score 0.05878084179970972 - nodes in this community are weakly interconnected._
- **Why does `findRole()` connect `Server Builder Setup` to `Bot Core & Music`, `Admin Commands`, `SVG Chart Rendering`, `Birthday Reminders`, `Security & Anti-Raid`, `Temporary Voice Channels`, `Seasons & Community Settings`, `Community Engagement Features`, `Support Tickets`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Should `SVG Chart Rendering` be split into smaller, more focused modules?**
  _Cohesion score 0.0653061224489796 - nodes in this community are weakly interconnected._
- **Should `Birthday Reminders` be split into smaller, more focused modules?**
  _Cohesion score 0.07948717948717948 - nodes in this community are weakly interconnected._