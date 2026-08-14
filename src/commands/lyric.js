import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

/* =========================================================
   CONFIG
========================================================= */

/*
 * ĐẶT ID KÊNH ĐƯỢC PHÉP DÙNG !lyric Ở ĐÂY.
 *
 * Ví dụ:
 *
 * const LYRIC_CHANNEL_ID = '123456789012345678';
 *
 * Chỉ người dùng gửi !lyric trong kênh này
 * mới được bot xử lý.
 */
const LYRIC_CHANNEL_ID = '1510183614535569448';


/*
 * API lyrics công khai.
 *
 * Endpoint:
 * https://api.lyrics.ovh/v1/{artist}/{title}
 *
 * API này trả về lyrics của bài hát nếu tìm được.
 */
const LYRIC_API_BASE = 'https://api.lyrics.ovh/v1';


/*
 * Giới hạn phần trích dẫn hiển thị trong Discord.
 *
 * Không sử dụng giá trị này để gửi toàn bộ lyrics.
 */
const MAX_EXCERPT_LENGTH = 220;


/*
 * Thời gian timeout cho request API.
 */
const API_TIMEOUT_MS = 10000;


/* =========================================================
   COMMAND
========================================================= */

const command = {

  /*
   * Giữ data để tương thích với hệ thống loadCommands()
   * hiện tại của bạn.
   *
   * Prefix command thực tế vẫn là:
   *
   * !lyric <tên bài hát>
   */
  data: new SlashCommandBuilder()
    .setName('lyric')
    .setDescription('Tìm thông tin và trích đoạn lời bài hát.')
    .addStringOption(option =>
      option
        .setName('song')
        .setDescription('Tên bài hát cần tìm')
        .setRequired(true)
    ),


  /*
   * Cho phép hệ thống prefix nhận command này.
   */
  prefix: true,


  /*
   * Category.
   */
  category: 'music',


  /*
   * =======================================================
   * EXECUTE
   * =======================================================
   *
   * Hỗ trợ cách gọi thông thường của hệ thống prefix:
   *
   * execute(message, args, client)
   *
   */
  async execute(message, args, client) {

    try {

      /* ===================================================
         BASIC VALIDATION
      =================================================== */

      if (!message) {
        return;
      }


      if (!message.guild) {
        return;
      }


      /*
       * Không cho phép bot tự xử lý message của bot.
       */
      if (message.author?.bot) {
        return;
      }


      /* ===================================================
         CHANNEL RESTRICTION
      =================================================== */

      if (
        LYRIC_CHANNEL_ID &&
        LYRIC_CHANNEL_ID !== '1510183614535569448' &&
        message.channel.id !== LYRIC_CHANNEL_ID
      ) {

        await message.reply({
          embeds: [
            createEmbed({
              title: '🎵 Lệnh Lyric',
              description:
                `Lệnh \`!lyric\` chỉ được sử dụng trong <#${LYRIC_CHANNEL_ID}>.`,
              color: 'info',
            }),
          ],
        }).catch(() => {});

        return;
      }


      /* ===================================================
         GET SONG NAME
      =================================================== */

      const songName =
        Array.isArray(args)
          ? args.join(' ').trim()
          : String(args || '').trim();


      if (!songName) {

        await message.reply({
          embeds: [
            createEmbed({
              title: '🎵 Lyric',
              description:
                'Vui lòng nhập tên bài hát.\n\n' +
                '**Ví dụ:**\n' +
                '`!lyric Shape of You`',
              color: 'info',
            }),
          ],
        }).catch(() => {});

        return;
      }


      /*
       * Giới hạn input để tránh request quá dài.
       */
      if (songName.length > 200) {

        await message.reply({
          embeds: [
            createEmbed({
              title: '❌ Tên bài hát quá dài',
              description:
                'Vui lòng nhập tên bài hát ngắn hơn 200 ký tự.',
              color: 'error',
            }),
          ],
        }).catch(() => {});

        return;
      }


      /* ===================================================
         SEARCH MESSAGE
      =================================================== */

      const searchingMessage =
        await message.reply({
          embeds: [
            createEmbed({
              title: '🔎 Đang tìm bài hát...',
              description:
                `Đang tìm lyrics cho **${escapeMarkdown(songName)}**...`,
              color: 'info',
            }),
          ],
        }).catch(() => null);


      /* ===================================================
         SEARCH API
      =================================================== */

      /*
       * lyrics.ovh cần artist + title.
       *
       * Vì !lyric chỉ nhận một chuỗi:
       *
       * !lyric Shape of You
       *
       * ta thử nhiều chiến lược.
       */

      const result =
        await findLyrics(songName);


      /* ===================================================
         NOT FOUND
      =================================================== */

      if (!result) {

        const payload = {
          embeds: [
            createEmbed({
              title: '❌ Không tìm thấy bài hát',
              description:
                `Không tìm thấy lyrics cho **${escapeMarkdown(songName)}**.\n\n` +
                'Bạn có thể thử nhập cả **tên ca sĩ + tên bài hát**.\n\n' +
                '**Ví dụ:**\n' +
                '`!lyric Ed Sheeran Shape of You`',
              color: 'error',
            }),
          ],
        };


        if (searchingMessage) {

          await searchingMessage.edit(
            payload
          ).catch(async () => {

            await message.channel.send(
              payload
            ).catch(() => {});

          });

        } else {

          await message.channel.send(
            payload
          ).catch(() => {});

        }


        return;
      }


      /* ===================================================
         CREATE EXCERPT
      =================================================== */

      const excerpt =
        createExcerpt(
          result.lyrics
        );


      /* ===================================================
         RESPONSE
      =================================================== */

      const embed =
        new EmbedBuilder()
          .setTitle('🎵 Lyrics')
          .setDescription(
            [
              `**${escapeMarkdown(result.title)}**`,
              result.artist
                ? `👤 **${escapeMarkdown(result.artist)}**`
                : null,
              '',
              '📖 **Trích đoạn:**',
              excerpt || 'Không có nội dung trích đoạn.',
              '',
              '⚠️ Đây chỉ là một đoạn trích ngắn. Không hiển thị toàn bộ lời bài hát.',
            ]
              .filter(Boolean)
              .join('\n')
          )
          .setTimestamp();


      const payload = {
        embeds: [embed],
      };


      /* ===================================================
         EDIT SEARCH MESSAGE
      =================================================== */

      if (searchingMessage) {

        await searchingMessage.edit(
          payload
        ).catch(async () => {

          await message.channel.send(
            payload
          ).catch(() => {});

        });

      } else {

        await message.channel.send(
          payload
        ).catch(() => {});

      }


    } catch (error) {

      console.error(
        '[LYRIC] Error:',
        error
      );


      await message.reply({
        embeds: [
          createEmbed({
            title: '❌ Có lỗi xảy ra',
            description:
              'Không thể tìm lyrics lúc này. Vui lòng thử lại sau.',
            color: 'error',
          }),
        ],
      }).catch(() => {});

    }

  },

};


/* =========================================================
   FIND LYRICS
========================================================= */

async function findLyrics(query) {

  const cleaned =
    query
      .replace(/\s+/g, ' ')
      .trim();


  if (!cleaned) {
    return null;
  }


  /*
   * =======================================================
   * STRATEGY 1
   * =======================================================
   *
   * Nếu người dùng nhập:
   *
   * Artist - Song
   *
   * thì tách trực tiếp.
   */

  const dashMatch =
    cleaned.match(
      /^(.+?)\s+-\s+(.+)$/
    );


  if (dashMatch) {

    const artist =
      dashMatch[1].trim();

    const title =
      dashMatch[2].trim();


    const result =
      await requestLyrics(
        artist,
        title
      );


    if (result) {

      return {
        artist,
        title,
        lyrics: result,
      };

    }

  }


  /*
   * =======================================================
   * STRATEGY 2
   * =======================================================
   *
   * Thử tách từ cuối:
   *
   * !lyric Ed Sheeran Shape of You
   *
   * Các artist/title không có cấu trúc cố định nên ta
   * thử nhiều điểm tách khác nhau.
   */

  const words =
    cleaned.split(' ');


  /*
   * Chỉ thử nếu có ít nhất 2 từ.
   */
  if (words.length >= 2) {

    /*
     * Thử các điểm chia từ phải sang trái.
     *
     * Ví dụ:
     *
     * Ed Sheeran Shape of You
     *
     * sẽ thử:
     *
     * Ed | Sheeran Shape of You
     * Ed Sheeran | Shape of You
     * Ed Sheeran Shape | of You
     *
     * ...
     */

    const maxAttempts =
      Math.min(
        words.length - 1,
        5
      );


    for (
      let i = 1;
      i <= maxAttempts;
      i++
    ) {

      const artist =
        words
          .slice(0, i)
          .join(' ');


      const title =
        words
          .slice(i)
          .join(' ');


      const result =
        await requestLyrics(
          artist,
          title
        );


      if (result) {

        return {
          artist,
          title,
          lyrics: result,
        };

      }

    }

  }


  /*
   * =======================================================
   * STRATEGY 3
   * =======================================================
   *
   * Một số API/source có thể nhận:
   *
   * artist = Unknown
   *
   * nên thử dùng toàn bộ query làm title.
   */

  const result =
    await requestLyrics(
      '',
      cleaned
    );


  if (result) {

    return {
      artist: '',
      title: cleaned,
      lyrics: result,
    };

  }


  return null;
}


/* =========================================================
   REQUEST LYRICS API
========================================================= */

async function requestLyrics(
  artist,
  title
) {

  /*
   * API yêu cầu title.
   */
  if (!title) {
    return null;
  }


  const encodedArtist =
    encodeURIComponent(
      artist || 'unknown'
    );


  const encodedTitle =
    encodeURIComponent(
      title
    );


  const url =
    `${LYRIC_API_BASE}/${encodedArtist}/${encodedTitle}`;


  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      API_TIMEOUT_MS
    );


  try {

    const response =
      await fetch(
        url,
        {
          method: 'GET',
          headers: {
            Accept:
              'application/json',
            'User-Agent':
              'TitanBot/1.0',
          },
          signal:
            controller.signal,
        }
      );


    if (!response.ok) {

      return null;

    }


    const data =
      await response.json();


    if (
      !data ||
      typeof data.lyrics !== 'string'
    ) {

      return null;

    }


    const lyrics =
      cleanLyrics(
        data.lyrics
      );


    if (!lyrics) {
      return null;
    }


    return lyrics;


  } catch (error) {

    /*
     * AbortError = API timeout.
     */
    if (
      error?.name ===
      'AbortError'
    ) {

      console.warn(
        '[LYRIC] API request timed out.'
      );

    } else {

      console.warn(
        '[LYRIC] API request failed:',
        error?.message || error
      );

    }


    return null;


  } finally {

    clearTimeout(
      timeout
    );

  }

}


/* =========================================================
   CLEAN LYRICS
========================================================= */

function cleanLyrics(lyrics) {

  return String(lyrics)

    /*
     * Normalize Windows line endings.
     */
    .replace(/\r\n/g, '\n')

    /*
     * Remove excessive blank lines.
     */
    .replace(/\n{3,}/g, '\n\n')

    /*
     * Remove spaces at line ends.
     */
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')

    .trim();

}


/* =========================================================
   CREATE SHORT EXCERPT
========================================================= */

function createExcerpt(lyrics) {

  if (!lyrics) {
    return '';
  }


  const cleaned =
    cleanLyrics(
      lyrics
    );


  /*
   * Lấy một đoạn ngắn ở đầu lyrics.
   */
  let excerpt =
    cleaned.slice(
      0,
      MAX_EXCERPT_LENGTH
    );


  /*
   * Không cắt giữa một từ.
   */
  if (
    cleaned.length >
    MAX_EXCERPT_LENGTH
  ) {

    const lastSpace =
      excerpt.lastIndexOf(
        ' '
      );


    if (
      lastSpace > 80
    ) {

      excerpt =
        excerpt.slice(
          0,
          lastSpace
        );

    }


    excerpt +=
      '…';

  }


  /*
   * Escape Discord markdown cơ bản.
   */
  return escapeMarkdown(
    excerpt
  );

}


/* =========================================================
   ESCAPE MARKDOWN
========================================================= */

function escapeMarkdown(text) {

  return String(text)

    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>');

}


/* =========================================================
   CREATE EMBED
   ---------------------------------------------------------
   Không phụ thuộc vào createEmbed() của project để file
   này có thể copy trực tiếp.
========================================================= */

function createEmbed({
  title,
  description,
  color = 'info',
}) {

  const colors = {

    info:
      0x3498db,

    error:
      0xe74c3c,

    success:
      0x2ecc71,

    warning:
      0xf1c40f,

  };


  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(
      colors[color] ??
      colors.info
    )
    .setTimestamp();

}


/* =========================================================
   EXPORT
========================================================= */

export default command;
