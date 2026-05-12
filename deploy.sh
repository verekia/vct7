docker buildx build --platform linux/arm64 --load -t verekia/vct7 .
docker save verekia/vct7 | gzip > /tmp/vct7.tar.gz
scp /tmp/vct7.tar.gz midgar:/tmp/
ssh midgar docker load --input /tmp/vct7.tar.gz
ssh midgar docker compose up -d vct7
