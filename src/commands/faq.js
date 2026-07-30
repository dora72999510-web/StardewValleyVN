const FAQ = require("../services/faqService");

const ALLOWED_ROLES = [
    "1510657849112399928",
    "1512650240765726791",
];

module.exports = async (message) => {

    if (!message.content.startsWith("!faq")) return;

    const hasPermission = message.member.roles.cache.some(role =>
        ALLOWED_ROLES.includes(role.id)
    );

    if (!hasPermission) return;

    const args = message.content.split(/\s+/);

    const key = args[1]?.toLowerCase();

    const user = message.mentions.users.first();

    if (!user)
        return message.reply("Bạn cần tag người chơi.");

    if (!FAQ[key])
        return message.reply("FAQ không tồn tại.");

    await message.channel.send(
        `${user}\n\n${FAQ[key]}`
    );

    await message.delete().catch(() => {});
};
