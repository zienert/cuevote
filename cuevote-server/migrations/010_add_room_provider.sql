-- Which music service a room plays. Every existing room is a YouTube room.
-- An 'apple' room plays Apple Music on the owner's device through MusicKit and
-- never takes YouTube tracks, so the provider is fixed when the room is created.
ALTER TABLE rooms ADD COLUMN provider TEXT NOT NULL DEFAULT 'youtube' CHECK (provider IN ('youtube', 'apple'));
