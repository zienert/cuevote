-- The two-letter country of an Apple room host's Apple account, as their
-- MusicKit player reports it. Suggestions in the room are looked up in this
-- storefront, because availability differs per country. NULL until the host
-- has connected Apple Music once; YouTube rooms leave it NULL.
ALTER TABLE rooms ADD COLUMN apple_storefront TEXT;
