# Build from the monorepo root:  docker build -f apps/api/Dockerfile .
FROM golang:1.25-alpine AS builder

WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api .
RUN CGO_ENABLED=0 go build -o /out/timely-api ./cmd

FROM alpine:3.21

WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY --from=builder /out/timely-api /app/timely-api
# goose.Up reads migrations from ./migrations relative to the working dir.
COPY --from=builder /src/migrations /app/migrations

EXPOSE 8080
CMD ["/app/timely-api"]
