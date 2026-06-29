import { PermissionsBitField } from 'discord.js';
import { logger } from '../utils/logger.js';
import { createEmbed } from '../utils/embeds.js';

const TARGET_CHANNEL_ID = '1521119945801334896';
const TARGET_ROLE_ID = '1521105636790636564';
const KEYWORD = 'Chúc mừng 2026';

const grantedCache = new Set();

export async function handleAutoRole(message) {
  try {
    if (!message.guild || message.author.bot) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const content = message.content.trim().toLowerCase();
    if (content !== KEYWORD.toLowerCase()) return;

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    if (member.roles.cache.has(TARGET_ROLE_ID)) return;

    const botMember = await message.guild.members.fetchMe();

    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;

    const role = message.guild.roles.cache.get(TARGET_ROLE_ID);
    if (!role) return;

    if (role.position >= botMember.roles.highest.position) return;

    await member.roles.add(role);

     await member.send({
      embeds: [
        createEmbed({
          title: '🎉 Bạn đã được cấp role!',
          description: `Bạn đã nhập đúng từ khóa và nhận được **${role.name}**`,
          color: 'success',
        }),
      ],
    }).catch(() => {});

    await message.channel.send(`✅ ${member} đã được cấp role **${role.name}**`).catch(() => {});

  } catch (err) {
    console.error(err);
  }
}
