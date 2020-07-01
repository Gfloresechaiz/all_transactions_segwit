sudo apt-get install git apt-transport-https -y &
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add - &
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
sudo apt update -y && sudo apt install yarn -y &
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.34.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
nvm install 12.0 
nvm use 12.0
git clone https://github.com/Gfloresechaiz/all_transactions_segwit
cd all*
touch .env 
cat <<EOT >> .env
AIRTABLE_API_KEY=
AIRTABLE_BASE=
AIRTABLE_TABLE=
EOT
yarn
node segwit.js --startAtBlock=634200 --stopAtBlock=637118
