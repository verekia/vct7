docker buildx build --platform linux/arm64 --load -t verekia/vct7 .
docker save -o /tmp/vct7.tar verekia/vct7
scp /tmp/vct7.tar midgar:/tmp/
ssh midgar docker load --input /tmp/vct7.tar
ssh midgar docker compose up -d vct7
