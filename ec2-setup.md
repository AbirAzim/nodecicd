# EC2 Setup (Amazon Linux)

How to get an Amazon Linux EC2 server ready to run this app with Docker Compose. Do this once, before following [deploy-job.md](deploy-job.md).

All commands below are run **on EC2**, after you SSH into it.

---

## Step 1: Check which Linux you have

```bash
cat /etc/os-release
```

Look at the `NAME=` and `VERSION=` lines. This guide is for Amazon Linux. Some commands differ between **Amazon Linux 2023** and **Amazon Linux 2**, and both are shown where needed.

---

## Step 2: Install Docker

> Already have Docker? Run `docker version`. If it shows both a **Client** and a **Server** section, skip to Step 3.

### 2a. Update the system

**Amazon Linux 2023:**

```bash
sudo dnf update -y
```

**Amazon Linux 2:**

```bash
sudo yum update -y
```

Updates all installed software to the latest versions before adding anything new.

| Part | Meaning |
| ---- | ------- |
| `dnf` / `yum` | The package manager, an "app store" for the command line. Amazon Linux 2023 uses `dnf`; Amazon Linux 2 uses `yum`. |
| `update` | Upgrade everything that's installed |
| `-y` | Answer "yes" automatically to "Is this ok?" |

### 2b. Install Docker

**Amazon Linux 2023:**

```bash
sudo dnf install -y docker
```

**Amazon Linux 2:**

```bash
sudo yum install -y docker
```

Downloads and installs Docker from Amazon's own package list.

### 2c. Start Docker, and make it start on every boot

```bash
sudo systemctl enable --now docker
```

| Part | Meaning |
| ---- | ------- |
| `systemctl` | The tool that manages background services on Linux |
| `enable` | Start Docker every time EC2 boots |
| `--now` | Also start it right now |

**Why:** installing Docker doesn't start it. Docker has two parts:

- the **client**, the `docker` command you type
- the **server** (also called the daemon), a background program that actually runs containers

The client only sends instructions to the server. If the server isn't running, every command fails with:

```
Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
```

`enable` also matters for later: if EC2 restarts and Docker doesn't start, your app is down and the next deploy fails.

### 2d. Check that it worked

```bash
sudo docker version
```

You should see two sections, **Client** and **Server**. (`sudo` is needed for now; Step 4 removes that.)

---

## Step 3: Install Docker Compose

On Amazon Linux, Docker is installed **without** Compose. So this works:

```bash
docker version           # ✅ works
```

but this doesn't:

```bash
docker compose version   # ❌ "compose" is not a docker command
```

Docker and Docker Compose are separate pieces. Compose is a **plugin** that you add to Docker.

### 3a. Create the plugin folder

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
```

Creates the folder where Docker looks for plugins.

- `sudo` runs the command as admin, because this folder belongs to the system
- `-p` means "don't complain if the folder already exists"

### 3b. Download Compose

```bash
sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" -o /usr/local/lib/docker/cli-plugins/docker-compose
```

Downloads Compose from Docker's official GitHub page into that folder.

| Part | Meaning |
| ---- | ------- |
| `curl` | Download a file from a URL |
| `-S` | Show errors if something goes wrong |
| `-L` | Follow redirects (GitHub sends you on to the real download link) |
| `$(uname -m)` | Fills in your CPU type automatically: `x86_64` for most instances, or `aarch64` for Graviton/ARM instances like `t4g` |
| `-o ...` | Save the downloaded file to this path |

You'll see a progress bar while it downloads.

> ⚠️ **This must be ONE line.** If your copy-paste splits it across several lines, you'll get errors like:
>
> ```
> curl: (2) no URL specified
> bash: https://github.com/...: No such file or directory
> ```
>
> That happens because the terminal runs each line as a separate command. Nothing breaks; just run it again as one line. Or use this version, where `\` at the end of a line means "the command continues on the next line":
>
> ```bash
> sudo curl -SL \
>   "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
>   -o /usr/local/lib/docker/cli-plugins/docker-compose
> ```

### 3c. Make it executable

```bash
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

Gives the file permission to run as a program (`+x` = "add execute permission"). Downloaded files can't run until you do this.

### 3d. Check that it worked

```bash
docker compose version
```

You should see:

```
Docker Compose version v2.x.x
```

---

## Step 4: Use Docker without `sudo`

By default, only the admin can use Docker. Add your user (`ec2-user`) to the `docker` group:

```bash
sudo usermod -aG docker ec2-user
```

| Part | Meaning |
| ---- | ------- |
| `usermod` | Change a user's settings |
| `-a` | **Add** to a group (without removing other groups) |
| `-G docker` | The group to add to |
| `ec2-user` | Your username |

Now **log out and SSH back in**. Group changes only apply to new logins:

```bash
exit
```

Then SSH in again and check:

```bash
docker ps
```

You should see an empty table (no "permission denied"):

```
CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES
```

**Why:** GitHub Actions logs in as `ec2-user` and runs `docker compose up`. If that needs `sudo`, the deploy fails.

---

## Checklist

Before moving on to [deploy-job.md](deploy-job.md), all of these should work **without errors**:

```bash
docker version
docker compose version
docker ps
```

Next: open ports 22 and 8080 in the Security Group (**Step 2** in [deploy-job.md](deploy-job.md)).
