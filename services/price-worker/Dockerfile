# Multi-stage build: compile with the full toolchain, ship only the binary.
# The resulting image is a few MB instead of ~800MB, which makes deploys fast
# and gives an attacker no shell to work with if the service is ever popped.

FROM golang:1.26-alpine AS builder

WORKDIR /src

# Copy manifests first. Docker caches this layer, so dependencies are only
# re-downloaded when go.mod/go.sum actually change — not on every code edit.
COPY go.mod go.sum* ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 produces a static binary with no libc dependency, which is what
# lets the scratch/alpine final stage run it at all.
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o /out/worker ./cmd/worker

FROM alpine:3.23

# TLS certificates — without these, any outbound HTTPS call to a price feed
# fails with "x509: certificate signed by unknown authority".
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 worker

COPY --from=builder /out/worker /usr/local/bin/worker

# Never run as root.
USER worker

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/worker"]
