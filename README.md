# ArchPackageWatcher
Track Arch Linux repo changes

Recommended Setup
-----------------

  1. Install `apw-git` from AUR
  2. Execute `apw init`, this will start a systemd user timer which updates from your local pacman database every hour.
  Thus apw depends on you to run `pacman -Sy` regularly to function.
  3. Add the following lines in your `.bashrc` or `.zshrc` file:
  ```
    if [[ $- == *i* ]]
    then
        apw
    fi
  ```
  4. When you see the changes, run `apw dismiss` to dismiss them.

Online Version: https://tokyo.cuoan.net/apw
