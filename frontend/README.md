# The Digest 📰

> O platformă de dovadă a citirii articolelor pe blockchain-ul Ethereum.

Proiect realizat pe rețeaua de test **Ethereum Sepolia**. Ideea centrală: în loc să ne bazăm pe simple vizualizări de pagină, am creat un sistem în care un cititor își poate dovedi lectura printr-un cost economic real — arderea de token-uri ERC-20. Fiecare citire verificată devine un eveniment permanent pe blockchain, imposibil de modificat sau șters.

---

## 🔗 Contracte deployate pe Sepolia

| Contract | Adresă |
|---|---|
| TokenFaucet | `0xDcdc55d38529231bfca066570290a4834429ffC3` |
| ProofOfReading | `0x28780957E1A38108006d7161784bBB8e790FEb10` |

---

## ✨ Funcționalități

- **Faucet** — revendică 100 DEV tokens gratuit o dată la 24 de ore
- **Articole on-chain** — publisherul postează articole direct pe blockchain cu un cost de citire în DEV
- **Burn to read** — cititorii ard token-uri DEV pentru a-și verifica lectura permanent
- **My Reads** — istoricul imutabil al citirilor verificate, legat de adresa de portofel
- **Leaderboard** — clasamentul cititorilor după DEV total ars, construit din evenimente blockchain
- **Activity feed** — feed în timp real al ultimelor citiri verificate pe platformă
- **Publish & deactivate** — owner-ul poate publica și dezactiva articole din interfață

---

## 🛠️ Stack tehnologic

**Smart Contracts**
- Solidity 0.8.20
- OpenZeppelin Contracts v5 (ERC20, ERC20Burnable, Ownable)
- Hardhat v2.22

**Frontend**
- React 18 + Vite
- Ethers.js v6
- MetaMask

---

## 📁 Structura proiectului

```
the-digest/
├── contracts/
│   ├── TokenFaucet.sol       # Token ERC-20 cu faucet
│   └── ProofOfReading.sol    # Contract principal
├── scripts/
│   └── deploy.js             # Script de deployment
├── frontend/
│   └── src/
│       ├── App.jsx           # Aplicația React
│       └── addresses.js      # Adresele contractelor
├── hardhat.config.js
└── .env.example
```

---

## ⚙️ Instalare și rulare locală

### Cerințe
- Node.js v18+
- MetaMask instalat în browser
- Sepolia ETH pentru gas ([sepoliafaucet.com](https://sepoliafaucet.com))

### Pași

```bash
# 1. Clonează repository-ul
git clone https://github.com/YOUR_USERNAME/the-digest.git
cd the-digest

# 2. Instalează dependințele Hardhat
npm install

# 3. Instalează dependințele frontend
cd frontend
npm install
cd ..

# 4. Configurează variabilele de mediu
cp .env.example .env
# Editează .env și adaugă PRIVATE_KEY și SEPOLIA_RPC_URL

# 5. Pornește aplicația
cd frontend
npm run dev
```

Deschide [http://localhost:5173](http://localhost:5173) și conectează MetaMask pe rețeaua Sepolia.

> **Notă:** Contractele sunt deja deployate pe Sepolia — nu este necesar să le redesfășori pentru a folosi aplicația.

---

## 🔄 Fluxul de citire verificată

```
Conectare MetaMask → Aprobare token spend → markAsRead() → burnFrom() → ArticleRead on-chain
```

1. Utilizatorul conectează portofelul MetaMask pe Sepolia
2. La prima citire, se trimite o tranzacție de aprobare ERC-20
3. Contractul ProofOfReading apelează burnFrom() pe TokenFaucet
4. Token-urile sunt distruse permanent și evenimentul ArticleRead este emis pe blockchain

---

## 🔐 Variabile de mediu

Creează un fișier `.env` în rădăcina proiectului:

```
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
PRIVATE_KEY=cheia_ta_privata
```

> ⚠️ Nu include niciodată `.env` în repository. Fișierul este ignorat prin `.gitignore`.

---

## 👥 Autori

Proiect realizat de **Robert** și **George** — 2026