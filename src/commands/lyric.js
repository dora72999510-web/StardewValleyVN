import { EmbedBuilder } from 'discord.js';

/* =========================================================
   CONFIG
========================================================= */

/*
 * Chỉ cho phép !lyric trong channel này.
 *
 * Nếu muốn đổi channel:
 * thay ID bên dưới bằng ID channel Discord.
 */
const LYRIC_CHANNEL_ID =
  process.env.LYRIC_CHANNEL_ID ||
  '1510183614535569448';


/*
 * Lyrics API công khai.
 */
const LYRIC_API_BASE =
  'https://api.lyrics.ovh/v1';


/*
 * Độ dài đoạn lyrics tối đa hiển thị.
 */
const MAX_EXCERPT_LENGTH = 220;


/*
 * Timeout API.
 */
const API_TIMEOUT_MS = 10000;


/* =========================================================
   COMMAND
========================================================= */

const command = {

  /*
   * Tên command để client.commands nhận diện.
   *
   * !lyric
   */
  data: {
    name: 'lyric',
    description: 'Tìm lyrics bài hát',
  },


  /*
   * Cho phép chạy bằng prefix.
   */
  prefix: true,


  /*
   * Category.
   */
  category: 'music',


  /* =======================================================
     EXECUTE
  ======================================================= */

  async execute(message, args, client) {

    try {

      /* =====================================================
         BASIC CHECK
      ===================================================== */

      if (!message) {
        return;
      }


      if (!message.guild) {
        return;
      }


      if (message.author?.bot) {
        return;
      }


      /* =====================================================
         CHANNEL CHECK
      ===================================================== */

      if (
        LYRIC_CHANNEL_ID &&
        message.channel.id !== LYRIC_CHANNEL_ID
      ) {

        await sendEmbed(
          message,
          {
            title: '🎵 Lệnh Lyric',
            description:
              `Bạn chỉ có thể sử dụng \`!lyric\` tại <#${LYRIC_CHANNEL_ID}>.`,
            color: 'info',
          }
        );

        return;
      }


      /* =====================================================
         GET SONG QUERY
         -----------------------------------------------------
         Đây là phần quan trọng nhất.

         Hệ thống prefix của bạn có thể truyền args dưới
         nhiều dạng khác nhau.

         Ví dụ:

         ['Shape', 'of', 'You']

         hoặc:

         {
           song: 'Shape of You'
         }

         hoặc:

         'Shape of You'

         Code dưới đây xử lý cả 3.
      ===================================================== */

      const songName =
        normalizeArguments(args);


      console.log(
        '[LYRIC] Raw args:',
        args
      );

      console.log(
        '[LYRIC] Normalized query:',
        songName
      );


      /* =====================================================
         EMPTY QUERY
      ===================================================== */

      if (!songName) {

        await sendEmbed(
          message,
          {
            title: '🎵 Lyric',
            description:
              'Vui lòng nhập tên bài hát.\n\n' +
              '**Ví dụ:**\n' +
              '`!lyric Shape of You`\n' +
              '`!lyric Ed Sheeran Shape of You`',
            color: 'info',
          }
        );

        return;
      }


      /* =====================================================
         MAX LENGTH
      ===================================================== */

      if (
        songName.length > 200
      ) {

        await sendEmbed(
          message,
          {
            title: '❌ Tên bài hát quá dài',
            description:
              'Vui lòng nhập tên bài hát ngắn hơn 200 ký tự.',
            color: 'error',
          }
        );

        return;
      }


      /* =====================================================
         SEARCH MESSAGE
      ===================================================== */

      const searchingMessage =
        await sendEmbed(
          message,
          {
            title: '🔎 Đang tìm bài hát...',
            description:
              `Đang tìm lyrics cho **${escapeMarkdown(songName)}**...`,
            color: 'info',
          }
        );


      /* =====================================================
         SEARCH
      ===================================================== */

      const result =
        await findLyrics(songName);


      /* =====================================================
         NOT FOUND
      ===================================================== */

      if (!result) {

        const payload =
          createEmbedPayload({
            title:
              '❌ Không tìm thấy bài hát',

            description:
              `Không tìm thấy lyrics cho **${escapeMarkdown(songName)}**.\n\n` +
              'Bạn có thể thử nhập cả **tên ca sĩ + tên bài hát**.\n\n' +
              '**Ví dụ:**\n' +
              '`!lyric Ed Sheeran Shape of You`',

            color:
              'error',
          });


        if (searchingMessage) {

          await searchingMessage
            .edit(payload)
            .catch(async () => {

              await message.channel
                .send(payload)
                .catch(() => {});

            });

        } else {

          await message.channel
            .send(payload)
            .catch(() => {});

        }

        return;
      }


      /* =====================================================
         CREATE EXCERPT
      ===================================================== */

      const excerpt =
        createExcerpt(
          result.lyrics
        );


      /* =====================================================
         RESULT EMBED
      ===================================================== */

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

              excerpt ||
                'Không có nội dung trích đoạn.',

              '',

              '⚠️ Đây chỉ là một đoạn trích ngắn.',
            ]
              .filter(Boolean)
              .join('\n')
          )
          .setColor(0x3498db)
          .setTimestamp();


      const payload = {
        embeds: [
          embed,
        ],
      };


      /* =====================================================
         EDIT SEARCH MESSAGE
      ===================================================== */

      if (searchingMessage) {

        await searchingMessage
          .edit(payload)
          .catch(async () => {

            await message.channel
              .send(payload)
              .catch(() => {});

          });

      } else {

        await message.channel
          .send(payload)
          .catch(() => {});

      }


      console.log(
        `[LYRIC] Success: ${result.artist || 'Unknown'} - ${result.title}`
      );


    } catch (error) {

      console.error(
        '[LYRIC] Error:',
        error
      );


      await sendEmbed(
        message,
        {
          title:
            '❌ Có lỗi xảy ra',

          description:
            'Không thể tìm lyrics lúc này. Vui lòng thử lại sau.',

          color:
            'error',
        }
      );

    }

  },

};


/* =========================================================
   NORMALIZE ARGUMENTS
   ---------------------------------------------------------
   FIX [object Object]
========================================================= */

function normalizeArguments(args) {

  /* -------------------------------------------------------
     NULL / UNDEFINED
  ------------------------------------------------------- */

  if (
    args === null ||
    args === undefined
  ) {

    return '';

  }


  /* -------------------------------------------------------
     STRING
  ------------------------------------------------------- */

  if (
    typeof args === 'string'
  ) {

    return cleanQuery(args);

  }


  /* -------------------------------------------------------
     ARRAY
  ------------------------------------------------------- */

  if (
    Array.isArray(args)
  ) {

    return cleanQuery(
      args
        .map(value => {

          if (
            value === null ||
            value === undefined
          ) {

            return '';

          }


          if (
            typeof value === 'string'
          ) {

            return value;

          }


          if (
            typeof value === 'number'
          ) {

            return String(value);

          }


          /*
           * Nếu phần tử là object,
           * cố lấy các field thường gặp.
           */

          if (
            typeof value === 'object'
          ) {

            return extractObjectText(
              value
            );

          }


          return '';

        })
        .filter(Boolean)
        .join(' ')
    );

  }


  /* -------------------------------------------------------
     OBJECT
  ------------------------------------------------------- */

  if (
    typeof args === 'object'
  ) {

    return cleanQuery(
      extractObjectText(args)
    );

  }


  /* -------------------------------------------------------
     OTHER
  ------------------------------------------------------- */

  return cleanQuery(
    String(args)
  );

}


/* =========================================================
   EXTRACT OBJECT TEXT
========================================================= */

function extractObjectText(value) {

  if (
    !value ||
    typeof value !== 'object'
  ) {

    return '';

  }


  /*
   * Các property phổ biến của hệ thống command.
   */
  const preferredKeys = [
    'song',
    'query',
    'search',
    'title',
    'name',
    'value',
    'content',
    'text',
  ];


  for (
    const key
    of preferredKeys
  ) {

    const current =
      value[key];


    if (
      typeof current === 'string' &&
      current.trim()
    ) {

      return current.trim();

    }

  }


  /*
   * Nếu object có args / arguments.
   */
  if (
    Array.isArray(value.args)
  ) {

    return value.args
      .map(item =>
        typeof item === 'string'
          ? item
          : extractObjectText(item)
      )
      .filter(Boolean)
      .join(' ');

  }


  if (
    Array.isArray(value.arguments)
  ) {

    return value.arguments
      .map(item =>
        typeof item === 'string'
          ? item
          : extractObjectText(item)
      )
      .filter(Boolean)
      .join(' ');

  }


  /*
   * Cuối cùng thử lấy toàn bộ giá trị string.
   */
  const strings =
    Object.values(value)
      .filter(
        item =>
          typeof item === 'string' &&
          item.trim()
      )
      .map(
        item =>
          item.trim()
      );


  if (
    strings.length > 0
  ) {

    return strings.join(' ');

  }


  return '';

}


/* =========================================================
   CLEAN QUERY
========================================================= */

function cleanQuery(value) {

  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

}


/* =========================================================
   FIND LYRICS
========================================================= */

async function findLyrics(query) {

  const cleaned =
    cleanQuery(query);


  if (!cleaned) {
    return null;
  }


  /* =======================================================
     STRATEGY 1
     Artist - Title
  ======================================================= */

  const dashMatch =
    cleaned.match(
      /^(.+?)\s+-\s+(.+)$/
    );


  if (dashMatch) {

    const artist =
      dashMatch[1].trim();

    const title =
      dashMatch[2].trim();


    const lyrics =
      await requestLyrics(
        artist,
        title
      );


    if (lyrics) {

      return {
        artist,
        title,
        lyrics,
      };

    }

  }


  /* =======================================================
     STRATEGY 2
     Artist + Title
  ======================================================= */

  const words =
    cleaned.split(/\s+/);


  if (
    words.length >= 2
  ) {

    /*
     * Thử tối đa 6 cách chia.
     *
     * Ví dụ:
     *
     * Ed Sheeran Shape of You
     *
     * Ed | Sheeran Shape of You
     * Ed Sheeran | Shape of You
     * ...
     */

    const maxAttempts =
      Math.min(
        words.length - 1,
        6
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


      const lyrics =
        await requestLyrics(
          artist,
          title
        );


      if (lyrics) {

        return {
          artist,
          title,
          lyrics,
        };

      }

    }

  }


  /*
   * API lyrics.ovh không hỗ trợ tìm kiếm theo title
   * một cách đáng tin cậy.
   *
   * Vì vậy nếu không có artist + title thì trả null.
   */

  return null;

}


/* =========================================================
   REQUEST LYRICS API
========================================================= */

async function requestLyrics(
  artist,
  title
) {

  if (!title) {
    return null;
  }


  const safeArtist =
    cleanQuery(
      artist || 'unknown'
    );


  const safeTitle =
    cleanQuery(
      title
    );


  if (!safeTitle) {
    return null;
  }


  const url =
    `${LYRIC_API_BASE}/` +
    `${encodeURIComponent(safeArtist)}/` +
    `${encodeURIComponent(safeTitle)}`;


  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () => controller.abort(),
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


    if (
      !response.ok
    ) {

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
        error?.message ||
        error
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

    .replace(
      /\r\n/g,
      '\n'
    )

    .replace(
      /\n{3,}/g,
      '\n\n'
    )

    .split('\n')

    .map(
      line =>
        line.trimEnd()
    )

    .join('\n')

    .trim();

}


/* =========================================================
   CREATE EXCERPT
========================================================= */

function createExcerpt(lyrics) {

  if (!lyrics) {
    return '';
  }


  const cleaned =
    cleanLyrics(lyrics);


  let excerpt =
    cleaned.slice(
      0,
      MAX_EXCERPT_LENGTH
    );


  if (
    cleaned.length >
    MAX_EXCERPT_LENGTH
  ) {

    const lastSpace =
      excerpt.lastIndexOf(' ');


    if (
      lastSpace > 80
    ) {

      excerpt =
        excerpt.slice(
          0,
          lastSpace
        );

    }


    excerpt += '…';

  }


  return escapeMarkdown(
    excerpt
  );

}


/* =========================================================
   ESCAPE MARKDOWN
========================================================= */

function escapeMarkdown(text) {

  return String(text)

    .replace(
      /\\/g,
      '\\\\'
    )

    .replace(
      /\*/g,
      '\\*'
    )

    .replace(
      /_/g,
      '\\_'
    )

    .replace(
      /~/g,
      '\\~'
    )

    .replace(
      /`/g,
      '\\`'
    )

    .replace(
      />/g,
      '\\>'
    );

}


/* =========================================================
   EMBED
========================================================= */

function createEmbedPayload({
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


  return {

    embeds: [

      new EmbedBuilder()

        .setTitle(title)

        .setDescription(
          description
        )

        .setColor(
          colors[color] ??
          colors.info
        )

        .setTimestamp(),

    ],

  };

}


/* =========================================================
   SEND EMBED
========================================================= */

async function sendEmbed(
  message,
  {
    title,
    description,
    color = 'info',
  }
) {

  return message.channel
    .send(
      createEmbedPayload({
        title,
        description,
        color,
      })
    )
    .catch(() => null);

}


/* =========================================================
   EXPORT
========================================================= */

export default command;
