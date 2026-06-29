import { PermissionsBitField } from 'discord.js';
import { logger } from '../utils/logger.js';
import { createEmbed } from '../utils/embeds.js';

const TARGET_CHANNEL_ID = '1510183614535569448';
const TARGET_ROLE_ID = '1516035792256892959';
const KEYWORD = 'tôi đồng ý';

const grantedCache = new Set();

export async function handleAutoRole(message) {
  try {
    if (!message.guild || message.author.bot) return;

    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const content = message.content.trim().toLowerCase();
    if (content !== KEYWORD.toLowerCase()) return;

    const member = await message.guild.members
      .fetch(message.author.id)
      .catch(() => null);

    if (!member) return;

    if (grantedCache.has(member.id)) return;
    if (member.roles.cache.has(TARGET_ROLE_ID)) {
      grantedCache.add(member.id);
      return;
    }

    const botMember = await message.guild.members.fetchMe();

    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      logger.warn('Bot thiếu quyền Manage Roles');
      return;
    }

    const role = message.guild.roles.cache.get(TARGET_ROLE_ID);
    if (!role) return;

    if (role.position >= botMember.roles.highest.position) {
      logger.warn('Role bot thấp hơn role target');
      return;
    }

    await member.roles.add(role);
    grantedCache.add(member.id);

    await member.send({
      embeds: [
        createEmbed({
          title: '🎉 Bạn đã được cấp role!',
          description: `Bạn đã nhập đúng từ khóa và được cấp **${role.name}**`,
          color: 'success',
        }),
      ],
    }).catch(() => {});

    await message.channel.send(
      `✅ ${member} đã được cấp role **${role.name}**`
    ).catch(() => {});

  } catch (err) {
    logger.error('AutoRole Error:', err);
  }
}
