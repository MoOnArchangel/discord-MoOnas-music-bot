require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const ytdlp = require("yt-dlp-exec");
const ffmpeg = require("ffmpeg-static");
const { spawn } = require("child_process");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Map to hold queues per guild
const queueMap = new Map();

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const guildId = message.guild.id;
  if (!queueMap.has(guildId)) {
    queueMap.set(guildId, { songs: [], player: createAudioPlayer(), connection: null, playing: false });
  }

  const serverQueue = queueMap.get(guildId);

  const args = message.content.split(" ");
  const command = args.shift().toLowerCase();

  if (command === "!play") {
    const url = args[0];
    if (!url) return message.reply("Provide a YouTube link!");

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("Join a voice channel first!");

    if (!serverQueue.connection) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: message.guild.voiceAdapterCreator
      });
      serverQueue.connection = connection;

      // Subscribe the player to the connection
      connection.subscribe(serverQueue.player);

      // When the player finishes, play next
      serverQueue.player.on(AudioPlayerStatus.Idle, () => {
        serverQueue.songs.shift();
        if (serverQueue.songs.length > 0) {
          playSong(guildId, serverQueue.songs[0]);
        } else {
          serverQueue.playing = false;
        }
      });
    }

    serverQueue.songs.push(url);
    message.reply(`Queued: ${url}`);

    if (!serverQueue.playing) {
      serverQueue.playing = true;
      playSong(guildId, serverQueue.songs[0]);
    }
  }

  if (command === "!skip") {
    if (!serverQueue.playing) return message.reply("Nothing is playing!");
    serverQueue.player.stop();
    message.reply("Skipped!");
  }

  if (command === "!stop") {
    if (serverQueue.connection) {
      serverQueue.player.stop();
      serverQueue.connection.destroy();
      serverQueue.connection = null;
      serverQueue.songs = [];
      serverQueue.playing = false;
      message.reply("Stopped and cleared the queue!");
    }
  }
});

async function playSong(guildId, url) {
  const serverQueue = queueMap.get(guildId);
  try {
    const stream = ytdlp.exec(url, {
      output: "-",
      format: "bestaudio",
      quiet: true
    });

    const ffmpegProcess = spawn(ffmpeg, [
      "-i", "pipe:0",
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "pipe:1"
    ]);

    stream.stdout.pipe(ffmpegProcess.stdin);

    const resource = createAudioResource(ffmpegProcess.stdout);
    serverQueue.player.play(resource);
  } catch (error) {
    console.error("Error playing song:", error);
  }
}

client.login(process.env.DISCORD_TOKEN);