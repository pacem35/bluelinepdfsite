-- Example: register an installer you've uploaded to R2, then publish it.
-- `npm run release:prepare -- path/to/installer` prints this statement filled in for you.
insert into public.releases (platform, version, r2_key, filename, sha256, size_bytes, published)
values ('windows', '1.0.0', 'windows/1.0.0/BluelinePDF-Setup-1.0.0.exe', 'BluelinePDF-Setup-1.0.0.exe',
        '<sha256>', 123456789, true);
