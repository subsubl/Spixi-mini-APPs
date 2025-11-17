# Changelog

All notable changes to this repository will be documented in this file.

## [Unreleased]

- Ongoing maintenance and bug fixes.

## [3.12.4] - 2025-11-17

- Bumped app version to 3.12.4

## [3.12.3] - 2025-11-17

- Removed UI connection logs and debug console output
- Cleaned up connection handshake and logic

## [3.12.2] - 2025-11-17

- Enhanced persistent connection behavior and visual feedback (no timeout)

## [3.12.1] - 2025-11-17

- Fixed connection deadlock by ensuring only ball owner initiates clock sync and adding timeout fallbacks

## [3.12.0] - 2025-11-17

- Implemented NTP-style clock synchronization on connect and periodic maintenance

## [3.11.0] - 2025-11-17

- Added adaptive network rate detection (3-second test after connection) and adjusted send rate dynamically

## [3.10.2] - 2025-11-17

- Ball rendering and interpolation fixes

## [3.10.1] - 2025-11-17

- Ball speed reduced by 6% and 1-second delayed launch after scoring

## [3.10.0] - 2025-11-17

- Redesign waiting screen: modern court animation and improved status, used as base revert point

<!-- Keep this file up-to-date. Use the following format: -->
<!-- ## [x.y.z] - yyyy-mm-dd -->
