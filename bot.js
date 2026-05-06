import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GENERATOR_CHANNEL_ID = "1488997560415682640";
const ALLOWED_ROLE_ID      = "1488521626059542538";
const EMBED_COLOR          = 0x0c0c0c;
const CREATION_COOLDOWN_MS = 10_000;
const ROOM_EMOJIS = ["🐡","🍄","🍓","🍋","🥝","👻","🐻","🍰","🧸","🐯","🐙","🦕","🌴","🍄‍🟫","🌼","🌺","🔥"];

// ─── STATE ────────────────────────────────────────────────────────────────────
// voiceChannelId → { voiceChannelId, ownerId, panelMessageId, locked, trustedUsers, userLimit, emoji, guildId }
const tempRooms = new Map();
const cooldowns = new Map();

function randomEmoji() {
  return ROOM_EMOJIS[Math.floor(Math.random() * ROOM_EMOJIS.length)];
}

function getRoomByOwner(ownerId) {
  for (const room of tempRooms.values()) {
    if (room.ownerId === ownerId) return room;
  }
  return undefined;
}

// ─── EMBED ────────────────────────────────────────────────────────────────────
function buildEmbed(room, guild) {
  const voiceChannel = guild.channels.cache.get(room.voiceChannelId);
  const channelName  = voiceChannel?.name ?? room.emoji;

  const statusLine = room.locked ? "🔒 Locked" : "🔓 Unlocked";
  const limitLine  = room.userLimit > 0
    ? `\nLimit: ${voiceChannel?.members?.filter(m => !m.user.bot).size ?? 0} / ${room.userLimit}`
    : "";

  const connected = voiceChannel
    ? [...voiceChannel.members.values()].filter(m => !m.user.bot)
    : [];

  let memberLines = connected.map(m => `<@${m.id}>`);
  let memberValue = memberLines.join("\n");
  if (memberValue.length > 950) {
    const truncated = [];
    let len = 0;
    for (let i = 0; i < memberLines.length; i++) {
      const line = memberLines[i] + "\n";
      if (len + line.length > 920) {
        truncated.push(`+ ${memberLines.length - i} more`);
        break;
      }
      truncated.push(memberLines[i]);
      len += line.length;
    }
    memberValue = truncated.join("\n");
  }
  if (!memberValue) memberValue = "*No one connected*";

  const owner    = guild.members.cache.get(room.ownerId);
  const avatarUrl = owner?.displayAvatarURL({ size: 256 }) ?? null;

  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(channelName)
    .setThumbnail(avatarUrl)
    .addFields(
      { name: "Status",            value: statusLine + limitLine, inline: false },
      { name: "Connected Members", value: memberValue,            inline: false },
    )
    .setDescription("You can manage your channel by using the buttons below.");
}

function buildComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("tv_rename").setLabel("Rename").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tv_limit") .setLabel("Set Limit").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tv_lock")  .setLabel("Lock").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tv_unlock").setLabel("Unlock").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tv_claim") .setLabel("Claim").setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("tv_trust")  .setLabel("Trust User").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tv_untrust").setLabel("Untrust User").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("tv_kick")   .setLabel("Kick User").setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

// ─── PANEL ────────────────────────────────────────────────────────────────────
async function sendOrUpdatePanel(room, guild) {
  const voiceChannel = guild.channels.cache.get(room.voiceChannelId);
  if (!voiceChannel) return;

  const embed      = buildEmbed(room, guild);
  const components = buildComponents();

  if (room.panelMessageId) {
    try {
      const existing = await voiceChannel.messages.fetch(room.panelMessageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed], components });
        return;
      }
    } catch {}
  }

  try {
    const msg = await voiceChannel.send({ embeds: [embed], components });
    room.panelMessageId = msg.id;
  } catch (err) {
    console.error("Failed to send panel:", err.message);
  }
}

// ─── ROOM CREATION ────────────────────────────────────────────────────────────
async function createTempRoom(member, client) {
  if (member.user.bot) return;
  if (!member.roles.cache.has(ALLOWED_ROLE_ID)) return;

  const now         = Date.now();
  const lastCreated = cooldowns.get(member.id) ?? 0;
  if (now - lastCreated < CREATION_COOLDOWN_MS) return;
  cooldowns.set(member.id, now);

  if (getRoomByOwner(member.id)) return;

  const generatorChannel = member.guild.channels.cache.get(GENERATOR_CHANNEL_ID);
  const categoryId       = generatorChannel?.parentId ?? null;
  const position         = generatorChannel ? (generatorChannel.rawPosition ?? 0) + 1 : undefined;

  const emoji = randomEmoji();
  const name  = `${emoji} ・ ${member.displayName}`;

  try {
    const vc = await member.guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      position,
      userLimit: 0,
      permissionOverwrites: [
        {
          id: member.guild.roles.everyone.id,
          deny: [
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        {
          id: ALLOWED_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.Stream,
            PermissionFlagsBits.UseVAD,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.UseSoundboard,
            PermissionFlagsBits.UseApplicationCommands,
            PermissionFlagsBits.UseEmbeddedActivities,
          ],
          deny: [
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.ManageChannels,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.Stream,
            PermissionFlagsBits.UseVAD,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.UseSoundboard,
            PermissionFlagsBits.UseApplicationCommands,
            PermissionFlagsBits.UseEmbeddedActivities,
          ],
        },
      ],
    });

    await member.voice.setChannel(vc).catch(() => {});

    const room = {
      voiceChannelId: vc.id,
      ownerId: member.id,
      panelMessageId: null,
      locked: false,
      trustedUsers: new Set(),
      userLimit: 0,
      emoji,
      guildId: member.guild.id,
    };
    tempRooms.set(vc.id, room);

    await sendOrUpdatePanel(room, member.guild);
    console.log(`[+] Room created: ${name} (${vc.id}) for ${member.user.tag}`);
  } catch (err) {
    console.error("Failed to create room:", err.message);
  }
}

async function deleteTempRoom(voiceChannelId, guild) {
  const room = tempRooms.get(voiceChannelId);
  if (!room) return;
  tempRooms.delete(voiceChannelId);
  const ch = guild.channels.cache.get(voiceChannelId);
  if (ch) {
    await ch.delete().catch(err => console.error("Failed to delete room:", err.message));
    console.log(`[-] Room deleted: ${voiceChannelId}`);
  }
}

// ─── VOICE STATE ──────────────────────────────────────────────────────────────
async function onVoiceStateUpdate(oldState, newState) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  if (newState.channelId === GENERATOR_CHANNEL_ID) {
    await createTempRoom(member, client);
    return;
  }

  const leftId   = oldState.channelId;
  const joinedId = newState.channelId;

  if (leftId) {
    const room = tempRooms.get(leftId);
    if (room) {
      const vc        = oldState.guild.channels.cache.get(leftId);
      const remaining = vc?.members.filter(m => !m.user.bot) ?? new Map();

      if (remaining.size === 0) {
        await deleteTempRoom(leftId, oldState.guild);
        return;
      }

      if (room.ownerId === member.id) {
        const next = remaining.first();
        if (next) {
          room.ownerId       = next.id;
          room.panelMessageId = null;
          await sendOrUpdatePanel(room, oldState.guild);
          console.log(`[~] Auto-claim: ${next.user.tag} is now owner of ${leftId}`);
        }
      } else {
        await sendOrUpdatePanel(room, oldState.guild);
      }
    }
  }

  if (joinedId && joinedId !== GENERATOR_CHANNEL_ID) {
    const room = tempRooms.get(joinedId);
    if (room) await sendOrUpdatePanel(room, newState.guild);
  }
}

// ─── BUTTON HANDLER ───────────────────────────────────────────────────────────
async function handleButton(interaction) {
  const { customId } = interaction;
  const member       = interaction.member;
  const userId       = member.id;
  const guild        = interaction.guild;

  let room = member.voice.channelId ? tempRooms.get(member.voice.channelId) : undefined;
  if (!room) room = getRoomByOwner(userId);

  if (!room) {
    return interaction.reply({ content: "You don't have an active temp room.", ephemeral: true });
  }
  if (room.ownerId !== userId) {
    return interaction.reply({ content: "Only the room owner can do that.", ephemeral: true });
  }

  const vc = guild.channels.cache.get(room.voiceChannelId);
  if (!vc) {
    return interaction.reply({ content: "Your room no longer exists.", ephemeral: true });
  }

  // Modal buttons — must NOT defer first
  if (customId === "tv_rename") {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId("tv_rename_modal")
        .setTitle("Rename Your Room")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tv_new_name")
              .setLabel("New room name")
              .setStyle(TextInputStyle.Short)
              .setValue(vc.name)
              .setMinLength(1)
              .setMaxLength(50)
              .setRequired(true)
          )
        )
    );
  }

  if (customId === "tv_limit") {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId("tv_limit_modal")
        .setTitle("Set User Limit")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("tv_limit_value")
              .setLabel("User limit (0 = unlimited, max 99)")
              .setStyle(TextInputStyle.Short)
              .setValue(String(room.userLimit))
              .setMinLength(1)
              .setMaxLength(2)
              .setRequired(true)
          )
        )
    );
  }

  // All other buttons — defer first, then do work
  await interaction.deferUpdate();

  switch (customId) {
    case "tv_lock": {
      room.locked = true;
      await vc.permissionOverwrites.edit(ALLOWED_ROLE_ID, { Connect: false });
      await vc.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: false });
      await sendOrUpdatePanel(room, guild);
      break;
    }
    case "tv_unlock": {
      room.locked = false;
      await vc.permissionOverwrites.edit(ALLOWED_ROLE_ID, { Connect: true });
      await vc.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: null });
      await sendOrUpdatePanel(room, guild);
      break;
    }
    case "tv_claim": {
      if (room.ownerId === userId) {
        return interaction.followUp({ content: "You already own this room.", ephemeral: true });
      }
      if (vc.members.has(room.ownerId)) {
        return interaction.followUp({ content: "The owner is still in the room.", ephemeral: true });
      }
      room.ownerId       = userId;
      room.panelMessageId = null;
      await sendOrUpdatePanel(room, guild);
      break;
    }
    case "tv_trust": {
      const others = vc.members.filter(m => !m.user.bot && m.id !== userId);
      if (others.size === 0) return interaction.followUp({ content: "No other members to trust.", ephemeral: true });
      const select = new StringSelectMenuBuilder()
        .setCustomId("tv_trust_select")
        .setPlaceholder("Select a member to trust")
        .addOptions(others.map(m => new StringSelectMenuOptionBuilder().setLabel(m.displayName).setValue(m.id)));
      return interaction.followUp({ content: "Select a member:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }
    case "tv_untrust": {
      if (room.trustedUsers.size === 0) return interaction.followUp({ content: "No trusted users.", ephemeral: true });
      const opts = [];
      for (const uid of room.trustedUsers) {
        const m = guild.members.cache.get(uid);
        if (m) opts.push(new StringSelectMenuOptionBuilder().setLabel(m.displayName).setValue(uid));
      }
      if (!opts.length) return interaction.followUp({ content: "No trusted users found.", ephemeral: true });
      const select = new StringSelectMenuBuilder()
        .setCustomId("tv_untrust_select")
        .setPlaceholder("Select a member to untrust")
        .addOptions(opts);
      return interaction.followUp({ content: "Select a member:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }
    case "tv_kick": {
      const others = vc.members.filter(m => !m.user.bot && m.id !== userId);
      if (others.size === 0) return interaction.followUp({ content: "No members to kick.", ephemeral: true });
      const select = new StringSelectMenuBuilder()
        .setCustomId("tv_kick_select")
        .setPlaceholder("Select a member to kick")
        .addOptions(others.map(m => new StringSelectMenuOptionBuilder().setLabel(m.displayName).setValue(m.id)));
      return interaction.followUp({ content: "Select a member:", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }
  }
}

// ─── SELECT MENU HANDLER ──────────────────────────────────────────────────────
async function handleSelectMenu(interaction) {
  const { customId, values } = interaction;
  const member = interaction.member;
  const userId = member.id;
  const guild  = interaction.guild;

  await interaction.deferUpdate();

  let room = member.voice.channelId ? tempRooms.get(member.voice.channelId) : undefined;
  if (!room) room = getRoomByOwner(userId);
  if (!room || room.ownerId !== userId) {
    return interaction.editReply({ content: "Action no longer valid.", components: [] });
  }

  const vc       = guild.channels.cache.get(room.voiceChannelId);
  const targetId = values[0];

  switch (customId) {
    case "tv_trust_select": {
      room.trustedUsers.add(targetId);
      await vc?.permissionOverwrites.edit(targetId, {
        Connect: true, ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
        Speak: true, Stream: true, UseVAD: true, UseSoundboard: true,
        UseApplicationCommands: true, UseEmbeddedActivities: true,
        AttachFiles: false, EmbedLinks: false,
      });
      return interaction.editReply({ content: `✅ Trusted <@${targetId}>.`, components: [] });
    }
    case "tv_untrust_select": {
      room.trustedUsers.delete(targetId);
      await vc?.permissionOverwrites.delete(targetId).catch(() => {});
      return interaction.editReply({ content: `✅ Removed trust from <@${targetId}>.`, components: [] });
    }
    case "tv_kick_select": {
      const target = vc?.members.get(targetId);
      if (!target) return interaction.editReply({ content: "That member is no longer in the room.", components: [] });
      await target.voice.disconnect("Kicked from temp room").catch(() => {});
      return interaction.editReply({ content: `✅ Kicked <@${targetId}>.`, components: [] });
    }
  }
}

// ─── MODAL HANDLER ────────────────────────────────────────────────────────────
async function handleModal(interaction) {
  const { customId } = interaction;
  const member = interaction.member;
  const userId = member.id;
  const guild  = interaction.guild;

  await interaction.deferUpdate();

  let room = member.voice.channelId ? tempRooms.get(member.voice.channelId) : undefined;
  if (!room) room = getRoomByOwner(userId);
  if (!room || room.ownerId !== userId) {
    return interaction.followUp({ content: "Action no longer valid.", ephemeral: true });
  }

  const vc = guild.channels.cache.get(room.voiceChannelId);
  if (!vc) return;

  switch (customId) {
    case "tv_rename_modal": {
      const rawName = interaction.fields.getTextInputValue("tv_new_name").trim();
      if (!rawName) return;
      await vc.setName(`${room.emoji} ・ ${rawName}`).catch(err => console.error("Rename failed:", err.message));
      await sendOrUpdatePanel(room, guild);
      break;
    }
    case "tv_limit_modal": {
      const limit = parseInt(interaction.fields.getTextInputValue("tv_limit_value").trim(), 10);
      if (isNaN(limit) || limit < 0 || limit > 99) {
        return interaction.followUp({ content: "Invalid limit. Use 0–99.", ephemeral: true });
      }
      room.userLimit = limit;
      await vc.setUserLimit(limit).catch(err => console.error("Set limit failed:", err.message));
      await sendOrUpdatePanel(room, guild);
      break;
    }
  }
}

// ─── GHOST CLEANUP ────────────────────────────────────────────────────────────
async function cleanupGhosts(client) {
  const emojiPattern = /^(🐡|🍄|🍓|🍋|🥝|👻|🐻|🍰|🧸|🐯|🐙|🦕|🌴|🍄‍🟫|🌼|🌺|🔥)/u;
  for (const guild of client.guilds.cache.values()) {
    const gen = guild.channels.cache.get(GENERATOR_CHANNEL_ID);
    if (!gen) continue;
    const catId = gen.parentId;
    for (const ch of guild.channels.cache.values()) {
      if (ch.type !== ChannelType.GuildVoice) continue;
      if (ch.id === GENERATOR_CHANNEL_ID) continue;
      if (catId && ch.parentId !== catId) continue;
      if (!emojiPattern.test(ch.name)) continue;
      const humans = ch.members.filter(m => !m.user.bot);
      if (humans.size === 0) {
        await ch.delete("Ghost cleanup on restart").catch(() => {});
        console.log(`[cleanup] Deleted ghost room: ${ch.name}`);
      }
    }
  }
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once("clientReady", async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    const me      = guild.members.me;
    const missing = [];
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) missing.push("Manage Channels");
    if (!me?.permissions.has(PermissionFlagsBits.MoveMembers))    missing.push("Move Members");
    if (missing.length) console.warn(`⚠️  Missing permissions in "${guild.name}": ${missing.join(", ")}`);
  }

  await cleanupGhosts(client);
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  try { await onVoiceStateUpdate(oldState, newState); }
  catch (err) { console.error("voiceStateUpdate error:", err.message); }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()          && interaction.customId.startsWith("tv_")) await handleButton(interaction);
    else if (interaction.isStringSelectMenu() && interaction.customId.startsWith("tv_")) await handleSelectMenu(interaction);
    else if (interaction.isModalSubmit()      && interaction.customId.startsWith("tv_")) await handleModal(interaction);
  } catch (err) {
    console.error("interactionCreate error:", err.message);
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error("❌ DISCORD_TOKEN env var is not set."); process.exit(1); }
client.login(token);
