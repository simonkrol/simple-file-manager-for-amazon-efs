<template>
  <div>
  <b-container fluid='true' class="bv-example-row">
  <b-row>
    <b-col>
        <h2>Upload</h2>
          <p> Path: {{ path }}</p>
          <div v-if=urlLoaded>
            <b-form-file
              multiple
              v-model="filesToUpload"
              :state="Boolean(filesToUpload)"
              placeholder="Choose a file or drop it here..."
              drop-placeholder="Drop file here..."
            ></b-form-file>
            <div v-if="uploading">
              <b-progress :value="value" :max="max" class="mb-3"></b-progress>
            </div>
          </div>
          <div v-if="!uploading">
            <b-button @click="uploadFiles()">Upload</b-button>
          </div>
    </b-col>
  </b-row>
</b-container>
  </div>
</template>

<script>
import { API } from 'aws-amplify';

export default {
  name: 'upload',
  props: ['nav', 'files'],
  computed: {
    path: function () {
      return this.nav[this.nav.length - 1].to.query.path
    },
    value: function () {
      return ((this.currentChunk + 1) / this.totalChunks) * 100
    },
    fileNames: function () {
      let fileNames = []
      this.files.forEach(element => fileNames.push(element.Name))
      return fileNames
    }
  },
  mounted: function () {
    this.urlLoaded = true
  },
  data () {
    return {
      urlLoaded: false,
      fileToUpload: null,
      totalChunks: 0,
      currentChunk: 0,
      max: 95,
      uploading: false,
      chunkSize: 1000000 // bytes
    }
  },
  methods: {
    afterComplete(status, message) {
      this.completions += 1;
      console.log("afterComplete: " + status + " " + message);
      if(!status) {
        this.failures.push(message);
      }
      if(this.completions == this.filesToUpload.length) {
        let formattedResponse = {type: this.failures.length >= 1 ? "danger" : "success", message: "Upload completed successfully."};
        if(this.failures.length >= 1)
        {
            formattedResponse.message = 
                (this.completions - this.failures.length) + 
                " file(s) completed successfully. " + 
                this.failures.length + 
                " file(s) did not complete successfully. Failures: [" + 
                this.failures.join(", ") + "]";
        }
        this.$emit('uploadCompleted', formattedResponse);
      }
    },
    blobToBase64(blob) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',').pop());
        reader.readAsDataURL(blob);
      });
    },
    async deleteFile (file) {
          let requestParams = { 
              queryStringParameters: {  
                path: this.path,
                name: file.name
            }
          };
          try {
              await API.del('fileManagerApi', '/api/objects/' + this.$route.params.id, requestParams)
          }
          catch (error) {
              console.log(error)
          }
    },
    async uploadChunk(file, chunkData) {  
      let requestParams = { 
          queryStringParameters: {  
            path: this.path,
            filename: file.name
          },
          headers: {
            "Content-Type": "application/json"
          },
          body: chunkData
      };
      let response = await API.post('fileManagerApi', '/api/objects/' + this.$route.params.id + '/upload', requestParams)
      let chunkStatus = false;
      if(response.statusCode == 200){
          chunkStatus = true
      }else{
          //Retry request
          response = await API.post('fileManagerApi', '/api/objects/' + this.$route.params.id + '/upload', requestParams)
          if(response.statusCode == 200){
            chunkStatus = true
          }else{
              chunkStatus = false
          }
      }
      return chunkStatus
    },
    async uploadFiles() {
        this.completions = 0;
        this.failures = [];
        for (let i = 0; i < this.filesToUpload.length; i++) {
          this.checkIfFileExists(this.filesToUpload[i])
        }
    },
    checkIfFileExists (file) {
      if (this.fileNames.indexOf(file.name) > -1 ) {
        console.log(file.name, this.fileNames)
        this.afterComplete(false, file.name + " already exists.")
      }
      else {
        this.upload(file, 0, 0)
      }
    },
    // this whole function needs to be cleaned up, notably reduce duplicate code by breaking out into functions - works well for now though
    async upload(file, chunkIndex, chunkOffset) {
      this.currentChunk = chunkIndex
      // first if block is for the first call to upload, e.g. when the button is clicked
      if (chunkIndex == 0 && chunkOffset == 0) {
        this.$emit('uploadStarted')
        let fileSize = file.size
        this.totalChunks = Math.ceil(fileSize / this.chunkSize)
        let chunk = file.slice(0, this.chunkSize + 1)
        let chunkData = {}
        this.uploading = true

        chunkData.dzchunkindex = 0
        chunkData.dztotalfilesize = fileSize
        chunkData.dzchunksize = this.chunkSize
        chunkData.dztotalchunkcount = this.totalChunks
        chunkData.dzchunkbyteoffset = 0
        chunkData.content = await this.blobToBase64(chunk)
        
        let chunkStatus = await this.uploadChunk(file, chunkData)
        if (!chunkStatus) { //Check if not a 200 response code 
          // Delete partially uploaded file.
          this.deleteFile(file)
          this.afterComplete(false, file.name + " was unable to be uploaded successfully. Check API logs.")
        }
        else {
          if (this.totalChunks == 1 || this.totalChunks < 1) {
            this.uploading = false
            this.afterComplete(true, "File uploaded successfully!")
          }
          else {
            let nextChunkIndex = 1
            let nextChunkOffset = this.chunkSize + 1
            this.upload(file, nextChunkIndex, nextChunkOffset)
          }
        }
      }
      // this case is hit recursively from the first call
      else {
        // check to see if the current chunk is equal to total chunks, if so we send the last bytes and return complete
        if (chunkIndex == this.totalChunks - 1) {
          let fileSize = file.size
          let chunk = file.slice(chunkOffset)
          let chunkData = {}
        
          chunkData.dzchunkindex = chunkIndex
          chunkData.dztotalfilesize = fileSize
          chunkData.dzchunksize = this.chunkSize
          chunkData.dztotalchunkcount = this.totalChunks
          chunkData.dzchunkbyteoffset = chunkOffset
          chunkData.content = await this.blobToBase64(chunk)
          
          let chunkStatus = await this.uploadChunk(file, chunkData)
          
          
          if (!chunkStatus) { //Check if not a 200 response code 
            // Delete partially uploaded file.
            this.deleteFile(file)
            this.afterComplete(false, file.name + " was unable to be uploaded successfully. Check API logs.")
          }
          else {
            this.uploading = false
            this.afterComplete(true, "File uploaded successfully!")
          }
        }
        // in this case there are chunks remaining, so we continue to upload chunks
        else {
          let fileSize = file.size
          let end = Math.min(chunkOffset + this.chunkSize, fileSize)
          let chunk = file.slice(chunkOffset, end)
          let chunkData = {}
        
          chunkData.dzchunkindex = chunkIndex
          chunkData.dztotalfilesize = fileSize
          chunkData.dzchunksize = this.chunkSize
          chunkData.dztotalchunkcount = this.totalChunks
          chunkData.dzchunkbyteoffset = chunkOffset
          chunkData.content = await this.blobToBase64(chunk)
          
          let chunkStatus = await this.uploadChunk(file, chunkData)
          
          if (!chunkStatus) { //Check if not a 200 response code 
            // Delete partially uploaded file.
            this.deleteFile(file)
            this.afterComplete(false, file.name + " was unable to be uploaded successfully. Check API logs.")
          }
          else {
            let nextChunkIndex = chunkIndex + 1
            let nextChunkOffset = end
            this.upload(file, nextChunkIndex, nextChunkOffset)
          }
        }
      }
    }
  }
}


</script>


<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>

button {
  margin-top: 5%;
}

</style>