async function handleProtectedChannels(message) {
  try {
    if (!PROTECTED_CHANNELS.includes(message.channel.id)) {
      return false;
    }

    const member = await message.guild.members
      .fetch(message.author.id)
      .catch(() => null);

    if (!member) return true;

    // Admin bypass
    if (
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
      member.roles.cache.some(r => EXEMPT_ROLE_IDS.includes(r.id))
    ) {
      return true;
    }

    // Xóa message trước
    await message.delete().catch(() => {});

    // CHECK PERMISSION TRƯỚC KHI TIMEOUT
    if (!member.moderatable) {
      logger.warn(`Cannot timeout ${member.user.tag} (role hierarchy or missing permission)`);
      return true;
    }

    // Timeout
    await member.timeout(
      PROTECTED_TIMEOUT,
      'Message in protected channel'
    );

    logger.warn(`Timed out: ${member.user.tag}`);

    // Embed DM
    try {
      await member.send({
        embeds: [
          createEmbed({
            title: '🚫 Bạn đã bị timeout',
            description:
              `Bạn đã gửi tin trong kênh cảnh báo.\n` +
              `Hình phạt: **1 ngày timeout**.`,
            color: 'error',
          }),
        ],
      });
    } catch (e) {
      logger.warn('Cannot DM user (closed DM)');
    }

    // Log channel
    const logChannel = await message.guild.channels
      .fetch('1510183155762597990')
      .catch(() => null);

    if (logChannel?.isTextBased()) {
      await logChannel.send(
        `🚫 ${member} đã bị timeout vì gửi tin nhắn vào <1521007503263928341>`
      );
    }

    // Warning message
    const warn = await message.channel.send(
      `🚫 ${member} đã bị timeout 1 ngày.`
    );

    setTimeout(() => warn.delete().catch(() => {}), 5000);

    return true;

  } catch (err) {
    logger.error('Protected channel error:', err);
    return true;
  }
}
