# Build from the monorepo root:  docker build -f apps/api/Dockerfile .
FROM golang:1.25-alpine AS builder

WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags "-X main.version=${VERSION}" -o /out/timely-api ./cmd

FROM alpine:3.21

WORKDIR /app
RUN apk add --no-cache ca-certificates
# Migrations are embedded in the binary; nothing else is needed at runtime.
COPY --from=builder /out/timely-api /app/timely-api

# Containers must listen on every interface; the default is loopback only.
ENV API_BIND=0.0.0.0
EXPOSE 8080
CMD ["/app/timely-api"]
