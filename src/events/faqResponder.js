const ALLOWED_ROLES = [
    "1510657849112399928",
    "1512650240765726791",
];

const FAQ = {
    baoloi: `Chào bạn!

Vui lòng đọc kỹ hướng dẫn...
Nếu vẫn gặp lỗi hãy gửi log SMAPI.`,
};

export async function handleFaq(message) {
    if (!message.content.startsWith("!faq")) return false;

    const member = message.member;

    if (
        !member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id))
    ) {
        return true;
    }

    const args = message.content.trim().split(/\s+/);

    const key = args[1]?.toLowerCase();
    console.log(message.content);
    console.log(args);
    console.log("KEY =", key);
    console.log("FAQ =", Object.keys(FAQ));

    const target = message.mentions.users.first();

    if (!target) {
        await message.reply("Vui lòng tag người chơi.");
        return true;
    }

    if (!FAQ[key]) {
        await message.reply("FAQ không tồn tại.");
        return true;
    }

    await message.channel.send(
        `${target}\n\n${FAQ[key]}`
    );

    await message.delete().catch(() => {});

    return true;
}
