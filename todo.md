# OpenTUI + Neovim Headless UI Project

## Overview

Build a headless Neovim renderer using OpenTUI library, providing a unified TUI experience with theme support and customizable editor modes.

## Core Setup

- [ ] Start up OpenTUI session
- [ ] Establish Neovim headless connection
- [ ] Set up basic message passing between Neovim and OpenTUI

## Theme System

- [ ] Implement base16 color scheme support on Neovim side
- [ ] Create uniform theme API for OpenTUI
- [ ] Design theme customization interface
- [ ] Add theme loading mechanism

## UI Modes

- [ ] **Mode 1: Transparent Mode**
  - [ ] Display raw Neovim UI as-is
  - [ ] Pass through all input directly to Neovim
  - [ ] Minimal OpenTUI overlay/intervention

- [ ] **Mode 2: Editor UI Mode**
  - [ ] Design simplified text editor interface
  - [ ] Integrate Neovim shortcuts/capabilities
  - [ ] Present as clean text box while maintaining Neovim power
  - [ ] Hide full editor chrome (status bars, etc.)

## Configuration System

- [ ] Design static configuration file format
- [ ] Create configuration loading mechanism
- [ ] Implement user-level config discovery (e.g., `~/.config/opentui-nvim/config.toml`)
- [ ] Add per-TUI app config override support
- [ ] Allow TUI authors to specify "use user configuration" flag
- [ ] Document configuration options

## API Design

- [ ] Define library API for TUI app integration
- [ ] Create mode selection API
- [ ] Build theme API documentation
- [ ] Add configuration API for TUI authors

## Documentation

- [ ] Write usage examples
- [ ] Document configuration file format
- [ ] Create integration guide for TUI authors
- [ ] Add theme customization guide
