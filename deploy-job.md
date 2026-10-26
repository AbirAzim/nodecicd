# Deploy to EC2 with GitHub Actions

A step-by-step guide to adding a `deploy` job that ships this app to an EC2 server every time you push to `main`.

> For a more secure version with no SSH key and port 22 closed, see [oidc-deploy.md](oidc-deploy.md).

## The big picture

```
push to main
     ↓
 test ✅  →  build ✅  →  deploy
                           ↓
             1. GitHub's computer logs into your EC2 with SSH
             2. Copies your code files to EC2
             3. Runs "docker compose up" on EC2
                           ↓
             your app is live at http://YOUR-EC2-IP:8080
```

GitHub's computer does exactly what you do by hand when you SSH into EC2. The difference is that it uses a key stored safely in GitHub instead of the `.pem` file on your Mac.

---

## Step 1: Prepare EC2

### 1a. Install Docker and Docker Compose

Follow [ec2-setup.md](ec2-setup.md). It covers installing Docker, installing Docker Compose, starting Docker on boot, and using Docker without `sudo`.

When you're done, SSH into EC2 and check that all of these work **without errors** and **without `sudo`**:

```bash
docker version
docker compose version
docker ps
```

**Why without `sudo`:** GitHub logs in as your normal user and runs `docker compose up`. If that needs `sudo`, the deploy fails.

### 1b. Note your username

```bash
whoami
```

It's usually `ec2-user` on Amazon Linux or `ubuntu` on Ubuntu. You'll need it in Step 3.

---

## Step 2: Open the ports in the Security Group

In the AWS console, go to **EC2 → your instance → Security tab → click the Security Group → Edit inbound rules**.

You need two rules:

| Type       | Port | Source      | Why                                     |
| ---------- | ---- | ----------- | --------------------------------------- |
| SSH        | 22   | `0.0.0.0/0` | So GitHub's computer can log in         |
| Custom TCP | 8080 | `0.0.0.0/0` | So you can open the app in a browser    |

**Why `0.0.0.0/0` (anywhere) for SSH:** GitHub's computers don't have a fixed IP address, so you can't allow just one. This is OK for learning because only someone with your `.pem` key can log in. Real companies restrict this more tightly.

---

## Step 3: Add secrets to GitHub

Never put your EC2 key or IP address directly in the YAML file, because anyone who can see the repo would see them. Store them as **secrets** instead. GitHub hides them, even in the logs.

Go to **your repo on GitHub → Settings → Secrets and variables → Actions → New repository secret**, and add three secrets:

| Name          | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| `EC2_HOST`    | Your EC2 **public IP**, e.g. `13.233.45.67` (from the EC2 console) |
| `EC2_USER`    | The username from Step 1b, e.g. `ec2-user`                      |
| `EC2_SSH_KEY` | The **whole contents** of your `.pem` file                      |

To copy the `.pem` contents on your Mac:

```bash
cat ~/path/to/your-key.pem | pbcopy
```

Then paste it. Include the `-----BEGIN ... KEY-----` and `-----END ... KEY-----` lines.

In the YAML you read these as `${{ secrets.EC2_HOST }}` and so on.

---

## Step 4: Write the deploy job

Add this at the **bottom** of `.github/workflows/build-deploy.yaml`, after the `build` job. Keep the same indentation as `test:` and `build:` (2 spaces):

```yaml
  deploy:
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: checkout code
        uses: actions/checkout@v4

      - name: Set up SSH key
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.EC2_SSH_KEY }}" > ~/.ssh/ec2.pem
          chmod 600 ~/.ssh/ec2.pem
          ssh-keyscan -H ${{ secrets.EC2_HOST }} >> ~/.ssh/known_hosts

      - name: Copy files to EC2
        run: |
          ssh -i ~/.ssh/ec2.pem ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} "mkdir -p ~/simple-node"
          scp -i ~/.ssh/ec2.pem app.js index.js package.json package-lock.json Dockerfile docker-compose.yaml ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }}:~/simple-node/

      - name: Start app on EC2
        run: |
          ssh -i ~/.ssh/ec2.pem ${{ secrets.EC2_USER }}@${{ secrets.EC2_HOST }} "cd ~/simple-node && docker compose up -d --build"
```

### What every line means

#### Job settings

| Line | Meaning |
| ---- | ------- |
| `deploy:` | The name of the new job |
| `needs: build` | Only run if `build` passed. Since `build` needs `test`, the order is test → build → deploy. |
| `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` | **Only deploy when code is pushed to main.** The workflow also runs on pull requests, and you don't want an unfinished PR going live. On a PR, test and build still run, but deploy is skipped. |
| `runs-on: ubuntu-latest` | A fresh Linux computer. Every job gets its own new machine. |

#### `checkout code`

Downloads your code. This computer is brand new, so it doesn't have your files yet. It needs them so it can copy them to EC2.

#### `Set up SSH key`

The `|` after `run:` means "the next lines are several commands, run them in order".

| Command | Meaning |
| ------- | ------- |
| `mkdir -p ~/.ssh` | Create the folder where SSH keeps keys |
| `echo "${{ secrets.EC2_SSH_KEY }}" > ~/.ssh/ec2.pem` | Write your secret key into a file called `ec2.pem`. This rebuilds your `.pem` file on GitHub's computer. |
| `chmod 600 ~/.ssh/ec2.pem` | Make the file readable only by its owner. SSH **refuses** keys that others can read. |
| `ssh-keyscan -H ... >> ~/.ssh/known_hosts` | Save EC2's identity in advance. The first time you SSH somewhere, it asks "Are you sure you want to continue connecting (yes/no)?". A robot can't type "yes", so this answers it ahead of time. |

#### `Copy files to EC2`

| Command | Meaning |
| ------- | ------- |
| `ssh ... "mkdir -p ~/simple-node"` | Log in to EC2 and create a `simple-node` folder (`-p` means "don't complain if it already exists") |
| `scp ... app.js index.js ... :~/simple-node/` | **scp** means "secure copy". It copies the listed files from GitHub's computer into that folder on EC2. |

The format is the same as your normal SSH: `-i keyfile user@host`.

**Why list the files one by one:** so only what's needed gets copied. If you add a new file later, such as a `routes/` folder, add it to this list (and use `scp -r` for folders).

#### `Start app on EC2`

```bash
ssh ... "cd ~/simple-node && docker compose up -d --build"
```

This logs into EC2 and runs:

- `cd ~/simple-node`: go into the folder
- `docker compose up`: start the app using `docker-compose.yaml`
- `--build`: **rebuild the image** from the new code. Without it, Docker would reuse the old image and your changes wouldn't show up.
- `-d`: run in the background ("detached"). Without it, the command would never finish, and the GitHub job would hang forever.

If the app is already running, `up` replaces the old container with the new one.

---

## Step 5: Push and watch

```bash
git add .
git commit -m "Add deploy to EC2 job"
git push origin main
```

On GitHub, open the **Actions** tab and click the latest run. You'll see three boxes:

```
test → build → deploy
```

Click any box to see its logs, step by step.

---

## Step 6: Check that it worked

In your browser:

- `http://YOUR-EC2-IP:8080` should show **Hello World**
- `http://YOUR-EC2-IP:8080/users` should show the user list

You can also SSH into EC2 and check:

```bash
cd ~/simple-node
docker compose ps        # is the container running?
docker compose logs      # should say "Server is running on port 8080"
```

**Test the whole pipeline:** change `'Hello World'` in `app.js` to something else, **update the test to match**, then push. A minute or two later the new text appears on EC2 without you touching the server. That's CI/CD working.

---

## If something fails

| Error in the logs | Likely cause |
| ----------------- | ------------ |
| `Permission denied (publickey)` | The `EC2_SSH_KEY` or `EC2_USER` secret is wrong. Check that you pasted the whole `.pem` file and the right username. |
| `Connection timed out` | Port 22 isn't open in the Security Group (Step 2), or `EC2_HOST` is wrong |
| `docker: command not found` / `unknown command: compose` | Docker or the Compose plugin is missing on EC2 (see [ec2-setup.md](ec2-setup.md), Steps 2–3) |
| `permission denied ... docker.sock` | Your user isn't in the docker group (see [ec2-setup.md](ec2-setup.md), Step 4) |
| Deploy succeeds but the browser won't load | Port 8080 isn't open in the Security Group (Step 2) |
| Deploy job says **skipped** | Expected on a pull request. It only deploys on a push to `main`. |

**The EC2 IP changes if you stop and start the instance.** If deploys suddenly start timing out, check the IP and update the `EC2_HOST` secret. An **Elastic IP** in AWS gives you an address that never changes.
