# Deploy to EC2 with OIDC + SSM (no SSH keys)

A more secure version of [deploy-job.md](deploy-job.md). GitHub deploys to EC2 **without** a `.pem` key and **without** port 22 open.

Before starting, finish [ec2-setup.md](ec2-setup.md) (Docker + Docker Compose installed on EC2).

---

## The big picture

### Old way (SSH)

```
GitHub ──(.pem key, port 22)──► EC2
         scp files, then ssh "docker compose up"
```

- A permanent key is stored in GitHub secrets. If it leaks, anyone can log into your server.
- Port 22 is open to the whole internet.

### New way (OIDC + SSM)

```
1. GitHub ──(signed proof: "I'm AbirAzim/nodecicd on main")──► AWS
2. AWS    ──(temporary credentials, expire in ~1 hour)──────► GitHub
3. GitHub ──("run these commands on EC2")───────────────────► SSM
4. SSM    ──────────────────────────────────────────────────► EC2
                                       git pull
                                       docker compose up -d --build
```

- **No keys stored in GitHub at all.**
- **Port 22 can be closed.** The SSM agent on EC2 connects *out* to AWS, so nothing needs to connect *in*.
- EC2 gets the new code itself with `git pull`.

### The pieces

| Piece | What it is | Its job |
| ----- | ---------- | ------- |
| **OIDC provider** | A setting in AWS IAM | Makes AWS trust login proofs from GitHub |
| **GitHub role** | An IAM role | What GitHub is allowed to do: send commands to your EC2 only |
| **EC2 role** | An IAM role attached to the server | Lets EC2 receive commands from SSM |
| **SSM** (Systems Manager) | An AWS service | Runs commands on EC2 without SSH |
| **SSM agent** | A program on EC2 | Waits for commands from SSM and runs them. **Pre-installed on Amazon Linux.** |

---

## Step 1: Collect the info you'll need

Open a notes file and write these down:

| Info | Where to find it | Example |
| ---- | ---------------- | ------- |
| **Account ID** | AWS console, click your name (top right) | `123456789012` |
| **Region** | Top right of the AWS console, next to your name | `ap-south-1` |
| **Instance ID** | EC2 → Instances → your instance | `i-0abc123def456789` |

The region is shown as a name (e.g. "Mumbai"). Click it to see the code (e.g. `ap-south-1`). You need the **code**.

---

## Step 2: Give EC2 permission to talk to SSM

The SSM agent is already on your server, but AWS won't accept it until the server has permission.

### 2a. Create the EC2 role

1. Go to **IAM → Roles → Create role**
2. **Trusted entity type:** AWS service
3. **Use case:** EC2 → Next
4. Search for and tick **`AmazonSSMManagedInstanceCore`** → Next
5. **Role name:** `ec2-ssm-role` → Create role

| Setting | Meaning |
| ------- | ------- |
| Trusted entity = EC2 | "Only EC2 servers may use this role" |
| `AmazonSSMManagedInstanceCore` | An AWS-made policy with exactly the permissions the SSM agent needs: register itself, receive commands, send back results |

### 2b. Attach the role to your instance

1. **EC2 → Instances →** select your instance
2. **Actions → Security → Modify IAM role**
3. Choose `ec2-ssm-role` → **Update IAM role**

### 2c. Check that EC2 shows up in SSM

1. Go to **Systems Manager → Fleet Manager**
2. Your instance should appear with **SSM Agent ping status: Online**

It can take **up to 5 minutes**. If it still doesn't appear, SSH in and restart the agent so it picks up the new role:

```bash
sudo systemctl restart amazon-ssm-agent
```

> **Bonus:** once your instance is Online, you can get a terminal on it **without SSH**. Go to **EC2 → your instance → Connect → Session Manager → Connect**. You'll use this later when port 22 is closed.

---

## Step 3: Put the code on EC2 (one time only)

The deploy runs `git pull`, which only works if the repo was cloned there first. SSH in (or use Session Manager) and run:

### 3a. Install git

```bash
sudo dnf install -y git
```

(On Amazon Linux 2, use `sudo yum install -y git`.)

### 3b. Clone the repo

```bash
cd /home/ec2-user
git clone https://github.com/AbirAzim/nodecicd.git
```

This creates the folder `/home/ec2-user/nodecicd` with your code.

**Why no password or key:** your repo is **public**, so anyone can clone it. If you make it private later, EC2 would need a *deploy key* (a read-only SSH key for this one repo).

### 3c. Try it by hand once

```bash
cd /home/ec2-user/nodecicd
docker compose up -d --build
```

Open `http://YOUR-EC2-IP:8080`. You should see **Hello World**. This is exactly what the pipeline will do automatically.

> If you get `port is already allocated`, an older copy of the app (e.g. from the SSH guide in `~/simple-node`) is still running. Stop it:
>
> ```bash
> cd ~/simple-node && docker compose down
> ```

---

## Step 4: Tell AWS to trust GitHub (OIDC provider)

This is done **once per AWS account**.

1. Go to **IAM → Identity providers → Add provider**
2. **Provider type:** OpenID Connect
3. **Provider URL:** `https://token.actions.githubusercontent.com`
4. **Audience:** `sts.amazonaws.com`
5. **Add provider**

| Setting | Meaning |
| ------- | ------- |
| Provider URL | Where GitHub's login proofs come from. AWS uses it to check that a proof is really signed by GitHub. |
| Audience | Who the proof is meant for. `sts.amazonaws.com` = "AWS's login service". |

After this, AWS *can* trust GitHub, but nobody is allowed to do anything yet. The next step decides **who** gets in and **what** they can do.

---

## Step 5: Create the role for GitHub

### 5a. Create the role

1. **IAM → Roles → Create role**
2. **Trusted entity type:** Web identity
3. **Identity provider:** `token.actions.githubusercontent.com`
4. **Audience:** `sts.amazonaws.com`
5. **GitHub organization:** `AbirAzim`
6. **GitHub repository:** `nodecicd`
7. **GitHub branch:** `main`
8. **Next** → skip the permissions page (click **Next**, we'll add our own in 5c)
9. **Role name:** `github-deploy-role` → **Create role**

### 5b. Check the trust policy

Open the role → **Trust relationships** tab. It should look like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:AbirAzim/nodecicd:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

The **trust policy** answers "**who** can use this role?"

| Part | Meaning |
| ---- | ------- |
| `Principal.Federated` | Logins coming from the GitHub OIDC provider (Step 4) |
| `sts:AssumeRoleWithWebIdentity` | "Trade a GitHub proof for temporary AWS credentials" |
| `aud = sts.amazonaws.com` | The proof must be meant for AWS |
| `sub = repo:AbirAzim/nodecicd:ref:refs/heads/main` | **The most important line.** Only workflows from *your* repo, on the *main* branch, can use this role. Without it, *any* GitHub repo in the world could use your role. |

### 5c. Add the permissions

Open the role → **Permissions** tab → **Add permissions → Create inline policy → JSON**, and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:<REGION>:<ACCOUNT_ID>:instance/<INSTANCE_ID>",
        "arn:aws:ssm:<REGION>::document/AWS-RunShellScript"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetCommandInvocation",
      "Resource": "*"
    }
  ]
}
```

Replace `<REGION>`, `<ACCOUNT_ID>` and `<INSTANCE_ID>` with your values from Step 1. Name the policy `ssm-deploy` → **Create policy**.

The **permissions policy** answers "**what** can this role do?"

| Part | Meaning |
| ---- | ------- |
| `ssm:SendCommand` on your instance | Send commands to **your one server**, not any other |
| `document/AWS-RunShellScript` | Only using AWS's "run shell commands" document |
| `ssm:GetCommandInvocation` | Check whether a command finished and read its output. (AWS doesn't let you limit this one to a single server, so it's `*`.) |

This is called **least privilege**: GitHub can do exactly one thing, run commands on one server, and nothing else in your AWS account.

### 5d. Copy the role ARN

On the role's summary page, copy the **ARN**. It looks like:

```
arn:aws:iam::123456789012:role/github-deploy-role
```

---

## Step 6: Add the values to GitHub

**Repo on GitHub → Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
| ---- | ----- |
| `AWS_ROLE_ARN` | The ARN from Step 5d |
| `AWS_REGION` | Your region code, e.g. `ap-south-1` |
| `EC2_INSTANCE_ID` | Your instance ID, e.g. `i-0abc123def456789` |

None of these are passwords. Without the trust policy, they're useless to anyone else. Storing them as secrets just keeps them out of your code.

If you set up the SSH guide before, you can **delete** `EC2_SSH_KEY`, `EC2_HOST` and `EC2_USER`. They're not needed any more.

---

## Step 7: Write the deploy job

Add this at the bottom of `.github/workflows/build-deploy.yaml`, after the `build` job. Keep the same indentation as `test:` and `build:` (2 spaces). If you added the SSH `deploy` job, **replace** it with this one.

```yaml
  deploy:
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Log in to AWS with OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Send deploy command to EC2
        id: deploy
        run: |
          COMMAND_ID=$(aws ssm send-command \
            --instance-ids "${{ secrets.EC2_INSTANCE_ID }}" \
            --document-name "AWS-RunShellScript" \
            --comment "Deploy ${{ github.sha }}" \
            --parameters 'commands=["set -e","cd /home/ec2-user/nodecicd","sudo -u ec2-user git pull","docker compose up -d --build"]' \
            --query "Command.CommandId" \
            --output text)
          echo "command_id=$COMMAND_ID" >> "$GITHUB_OUTPUT"

      - name: Wait for deploy and show output
        run: |
          aws ssm wait command-executed \
            --command-id "${{ steps.deploy.outputs.command_id }}" \
            --instance-id "${{ secrets.EC2_INSTANCE_ID }}" || true

          aws ssm get-command-invocation \
            --command-id "${{ steps.deploy.outputs.command_id }}" \
            --instance-id "${{ secrets.EC2_INSTANCE_ID }}" \
            --query "[Status, StandardOutputContent, StandardErrorContent]" \
            --output text

          STATUS=$(aws ssm get-command-invocation \
            --command-id "${{ steps.deploy.outputs.command_id }}" \
            --instance-id "${{ secrets.EC2_INSTANCE_ID }}" \
            --query "Status" \
            --output text)
          [ "$STATUS" = "Success" ]
```

### What every part means

#### Job settings

| Line | Meaning |
| ---- | ------- |
| `needs: build` | Only deploy if the tests and build passed |
| `if: ... push ... main` | Only deploy on a push to `main`, never on a pull request |
| `permissions: id-token: write` | **Required for OIDC.** Lets this job ask GitHub for the signed proof ("I'm AbirAzim/nodecicd on main"). Without it, the login step fails. |
| `permissions: contents: read` | Lets the job read the repo. When you set `permissions`, everything not listed is turned off, so this has to be added back. |

**There's no `checkout code` step.** This job doesn't need your files: EC2 gets the code itself with `git pull`.

#### `Log in to AWS with OIDC`

An official AWS action that does the whole OIDC exchange:

1. Asks GitHub for the signed proof
2. Sends it to AWS and asks to use `AWS_ROLE_ARN`
3. AWS checks the trust policy (right repo? right branch?)
4. If OK, AWS returns temporary credentials, and the action saves them so every `aws` command after it is logged in

**No access keys appear anywhere.** That's the whole point of OIDC.

#### `Send deploy command to EC2`

`aws ssm send-command` asks SSM to run commands on your server. The `\` at the end of each line means "the command continues on the next line".

| Part | Meaning |
| ---- | ------- |
| `--instance-ids` | Which server |
| `--document-name "AWS-RunShellScript"` | "Run these as Linux shell commands" |
| `--comment "Deploy ${{ github.sha }}"` | A label with the commit ID, shown in the SSM console so you can tell deploys apart |
| `--parameters 'commands=[...]'` | The commands to run, in order (see below) |
| `--query "Command.CommandId" --output text` | From AWS's big response, print only the command's ID |
| `COMMAND_ID=$(...)` | Save that ID in a variable |
| `echo "command_id=..." >> "$GITHUB_OUTPUT"` | Pass the ID to the next step. Steps can't share shell variables, so this is how one step hands a value to another. The next step reads it as `steps.deploy.outputs.command_id` (`deploy` is this step's `id`). |

**The commands that run on EC2:**

| Command | Meaning |
| ------- | ------- |
| `set -e` | Stop at the first error. Without it, if `git pull` failed, it would still run `docker compose up` with the old code and report success. |
| `cd /home/ec2-user/nodecicd` | Go to the cloned repo |
| `sudo -u ec2-user git pull` | Download the latest code **as `ec2-user`** (see below) |
| `docker compose up -d --build` | Rebuild the image with the new code and restart the container in the background |

**Why `sudo -u ec2-user`:** SSM runs commands as **root**, not as `ec2-user`. But the repo folder belongs to `ec2-user`, because that's who cloned it. If root runs `git pull` there, git refuses with a `dubious ownership` error. `sudo -u ec2-user` means "run this as ec2-user". Docker runs fine as root, so `docker compose` doesn't need it.

#### `Wait for deploy and show output`

`send-command` only **starts** the commands and returns immediately. It doesn't wait. This step waits and reports the result.

| Part | Meaning |
| ---- | ------- |
| `aws ssm wait command-executed ...` | Check every 5 seconds until the commands finish (gives up after ~100 seconds) |
| `\|\| true` | "Don't stop here even if waiting fails". We want to see the output first, then decide pass/fail. |
| `aws ssm get-command-invocation ... --query "[Status, StandardOutputContent, StandardErrorContent]"` | Print the result: status, plus everything EC2 printed. Docker's build log appears here, so you can read it in GitHub. |
| `STATUS=$(...)` | Get just the status, e.g. `Success` or `Failed` |
| `[ "$STATUS" = "Success" ]` | The final check. If the status isn't `Success`, this line fails, so the job fails and you get a ❌. |

---

## Step 8: Push and watch

```bash
git add .
git commit -m "Deploy to EC2 with OIDC and SSM"
git push origin main
```

Go to the **Actions** tab on GitHub. You should see:

```
test → build → deploy
```

Open the `deploy` job. The last step shows what happened on EC2.

You can also see every deploy in AWS: **Systems Manager → Run Command → Command history**.

---

## Step 9: Check that it worked

Open `http://YOUR-EC2-IP:8080`. You should see your app.

Test the whole pipeline: change `'Hello World'` in `app.js`, **update the test to match**, push, and refresh the browser a minute later.

---

## Step 10: Close port 22

Once a deploy has worked:

1. **EC2 → your instance → Security → Security group → Edit inbound rules**
2. **Delete** the SSH (port 22) rule
3. Keep the **8080** rule (for the browser)

Now nobody can SSH into your server from the internet, including GitHub. Deploys still work, because they go through SSM.

To get a terminal on EC2 from now on: **EC2 → your instance → Connect → Session Manager → Connect**.

---

## If something fails

| Error | Likely cause |
| ----- | ------------ |
| `Could not load credentials from any providers` / `Credentials could not be loaded` | `permissions: id-token: write` is missing from the deploy job |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | The trust policy doesn't match. Check that the `sub` line is exactly `repo:AbirAzim/nodecicd:ref:refs/heads/main` (correct capitals), and that you pushed to `main`. |
| `AccessDeniedException ... ssm:SendCommand` | The permissions policy has a wrong region, account ID or instance ID |
| `InvalidInstanceId` | The instance isn't registered with SSM. Check **Fleet Manager** (Step 2c): is it Online? Is `ec2-ssm-role` attached? |
| Status `Failed`, output says `dubious ownership` | `git pull` ran as root. Make sure it's `sudo -u ec2-user git pull`. |
| Status `Failed`, output says `No such file or directory` | The repo isn't cloned at `/home/ec2-user/nodecicd` (Step 3b) |
| Status `Failed`, output says `unknown command: compose` | Docker Compose isn't installed (see [ec2-setup.md](ec2-setup.md)) |
| Status `Failed`, output says `compose build requires buildx 0.17.0 or later` | Buildx is missing or too old (see [ec2-setup.md](ec2-setup.md), Step 3e) |
| `Waiter CommandExecuted failed: Max attempts exceeded` | The command took more than ~100 seconds (usually a slow first build). Check **Systems Manager → Run Command** to see if it finished anyway. |
| `port is already allocated` | Another copy of the app is running (see the note in Step 3c) |

---

## SSH vs OIDC: what changed

| | SSH ([deploy-job.md](deploy-job.md)) | OIDC + SSM (this guide) |
| --- | --- | --- |
| How GitHub logs in | Permanent `.pem` key in secrets | Temporary credentials, expire in ~1 hour |
| What's stored in GitHub | A private key | Only a role name, region and instance ID |
| Port 22 | Open to the internet | **Closed** |
| How code gets to EC2 | `scp` from GitHub | EC2 runs `git pull` |
| Who can deploy | Anyone with the key | Only `AbirAzim/nodecicd` on `main` |
