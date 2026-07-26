/** Встроенный конфиг yt-dlp, используемый как начальное значение приложения. */
export const DEFAULT_YTDLP_CONFIG = `# Default yt-dlp CLI config

# Save downloads into the platform Downloads folder.
-P
__SAVVY_DOWNLOAD_DIR__

# Clean filenames and keep playlists organized.
-o
%(uploader|Unknown)s/%(playlist|Singles)s/%(playlist_index|)s%(title)s_[%(id)s].%(ext)s
--windows-filenames
--trim-filenames
180

# Best video+audio with a reasonable ceiling for day-to-day use.
-f
bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b
--merge-output-format
mkv
--format-sort
res:1080,fps,hdr:12,vcodec:av01,vcodec:vp9.2,vcodec:vp9,vcodec:h264,acodec:opus,acodec:aac

# Resume downloads and avoid overwriting finished files.
--continue
--part
--no-overwrites
--no-post-overwrites

# Keep useful metadata.
--embed-metadata
--embed-thumbnail
--convert-thumbnails
jpg
--write-info-json

# Better playlist behavior.
--yes-playlist
--playlist-reverse

# More robust network behavior.
--ignore-errors
--retries
10
--fragment-retries
10
--file-access-retries
10
--extractor-retries
10
--sleep-requests
1

# Skip files already downloaded before.
--download-archive
__SAVVY_DOWNLOAD_ARCHIVE__
`;
