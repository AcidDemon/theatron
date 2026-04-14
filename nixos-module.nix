# NixOS module for theatron session recording web UI.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.theatron;
  inherit (lib)
    mkEnableOption
    mkOption
    mkIf
    types
    ;
in
{
  options.services.theatron = {
    enable = mkEnableOption "theatron session recording web UI";

    package = mkOption {
      type = types.package;
      description = "The theatron package to use.";
    };

    bind = mkOption {
      type = types.str;
      default = "127.0.0.1:3000";
      description = "Listen address for the web UI.";
    };

    storageDir = mkOption {
      type = types.path;
      default = "/var/lib/epitropos-collector";
      description = "Root directory containing session recordings.";
    };

    storageMode = mkOption {
      type = types.enum [ "collector" "local" ];
      default = "collector";
      description = "Storage layout: collector (senders/*/recordings/) or local (user dirs).";
    };

    staticDir = mkOption {
      type = types.path;
      default = "${cfg.package}/share/theatron/frontend";
      description = "Directory containing the static frontend files.";
    };
  };

  config = mkIf cfg.enable {
    users.users.theatron = {
      isSystemUser = true;
      group = "theatron";
      description = "Theatron web UI daemon";
      home = "/var/empty";
      shell = "/run/current-system/sw/bin/nologin";
      extraGroups = [ "katagrapho-readers" ];
    };

    users.groups.theatron = { };

    systemd.services.theatron = {
      description = "Theatron session recording web UI";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      serviceConfig = {
        Type = "simple";
        ExecStart = "${lib.getExe cfg.package} --dir ${cfg.storageDir} --mode ${cfg.storageMode} --static ${cfg.staticDir} --bind ${cfg.bind}";
        User = "theatron";
        Group = "theatron";
        Restart = "on-failure";
        RestartSec = 5;

        ProtectSystem = "strict";
        ReadOnlyPaths = [ cfg.storageDir cfg.staticDir ];
        PrivateTmp = true;
        NoNewPrivileges = true;
        ProtectHome = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        SystemCallArchitectures = "native";
        PrivateDevices = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
      };
    };
  };
}
