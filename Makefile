SHELL := /bin/bash

CONTAINER_RUNTIME := $(shell command -v podman 2>/dev/null || command -v docker 2>/dev/null || echo "")
COMPOSE := $(shell \
	if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then echo "docker compose"; \
	elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then echo "podman compose"; \
	elif command -v podman-compose >/dev/null 2>&1; then echo "podman-compose"; \
	elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"; \
	else echo ""; fi)
IMAGE := sysdyn:dev
APP_DIR := /app
PORT ?= 5173
VOLUME_FLAGS := $(shell [ "$(CONTAINER_RUNTIME)" = "podman" ] && echo ":Z" || echo "")
# Keep container-installed dependencies when mounting source from host
NODE_MODULE_VOLUMES := -v $(APP_DIR)/node_modules -v $(APP_DIR)/packages/sysdyn-core/node_modules -v $(APP_DIR)/packages/sysdyn-demo/node_modules
RUN_BASE := $(CONTAINER_RUNTIME) run --rm $(NODE_MODULE_VOLUMES) -v "$(PWD)":$(APP_DIR)$(VOLUME_FLAGS) -w $(APP_DIR) $(IMAGE)
RUN_IT := $(CONTAINER_RUNTIME) run --rm -it $(NODE_MODULE_VOLUMES) -v "$(PWD)":$(APP_DIR)$(VOLUME_FLAGS) -w $(APP_DIR) $(IMAGE)

.PHONY: help build test test-core build-core demo demo-image up down logs shell clean

help:
	@echo ""
	@echo "  sysdyn (container-only interface)"
	@echo "  ---------------------------------"
	@echo "  make build        Build dev image"
	@echo "  make test         Run all tests in container"
	@echo "  make test-core    Run core tests in container"
	@echo "  make build-core   Build core package in container"
	@echo "  make demo         Run interactive demo (foreground, live source, http://localhost:$(PORT))"
	@echo "  make demo-image   Run interactive demo from image contents (foreground)"
	@echo "  make up           Start demo via compose (detached, http://localhost:$(PORT))"
	@echo "  make down         Stop/remove compose demo containers"
	@echo "  make logs         Follow compose demo logs"
	@echo "  make shell        Open shell in container"
	@echo "  make clean        Remove image"
	@echo ""

check-runtime:
	@if [ -z "$(CONTAINER_RUNTIME)" ]; then \
		echo "Error: no container runtime (podman/docker) found."; \
		exit 1; \
	fi

build: check-runtime
	$(CONTAINER_RUNTIME) build -t $(IMAGE) -f Containerfile .

test: build
	$(RUN_BASE) npm test

test-core: build
	$(RUN_BASE) npm run test -w packages/sysdyn-core

build-core: build
	$(RUN_BASE) npm run build -w packages/sysdyn-core

demo: build
	$(CONTAINER_RUNTIME) run --rm -it -p $(PORT):5173 $(NODE_MODULE_VOLUMES) -v "$(PWD)":$(APP_DIR)$(VOLUME_FLAGS) -w $(APP_DIR) $(IMAGE) npm run dev:demo -- --host 0.0.0.0

# Runs the app using code baked into the image (no bind mount) - useful for container-only execution
demo-image: build
	$(CONTAINER_RUNTIME) run --rm -it -p $(PORT):5173 -w $(APP_DIR) $(IMAGE)

check-compose:
	@if [ -z "$(COMPOSE)" ]; then \
		echo "Error: no compose command found (docker compose / podman compose / podman-compose / docker-compose)."; \
		exit 1; \
	fi

up: check-compose
	SYSDYN_ROOT=$(PWD) PORT=$(PORT) $(COMPOSE) up -d --build

down: check-compose
	SYSDYN_ROOT=$(PWD) PORT=$(PORT) $(COMPOSE) down --remove-orphans
	-$(CONTAINER_RUNTIME) rm -f sysdyn-demo >/dev/null 2>&1 || true

logs: check-compose
	SYSDYN_ROOT=$(PWD) PORT=$(PORT) $(COMPOSE) logs -f demo

shell: build
	$(RUN_IT) bash

clean: check-runtime
	-$(CONTAINER_RUNTIME) rmi -f $(IMAGE) >/dev/null 2>&1 || true
	-$(CONTAINER_RUNTIME) rm -f sysdyn-demo >/dev/null 2>&1 || true
